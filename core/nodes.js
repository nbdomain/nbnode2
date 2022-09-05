const config = require('./config').CONFIG
const axios = require('axios')
const coinfly = require('coinfly')
const rwc = require("random-weighted-choice")
var dns = require("dns");
const { NodeServer, NodeClient } = require('./nodeAPI');
const { DEF } = require('./def');
const CONSTS = require('./const');

let wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let objLen = obj => { return obj ? Object.keys(obj).length : 0 }
let g_node = null
class Nodes {
    constructor() {
        this.pnodes = []
        this._canResolve = true
        this.nodeClients = {}
        //this.isProducer = config.server.producer
    }
    async sleep(seconds) {
        return new Promise(resolve => {
            setTimeout(resolve, seconds * 1000);
        })
    }

    get({ retUrl = true }) {
        const node = rwc(this.pnodes)
        return retUrl ? node : this.pnodes.find(item => item.id === node)
    }
    cool(url) {
        const node = this.pnodes.find(node => node.id == url)
        if (node) {
            node.weight--
        }
    }
    warm(url) {
        const node = this.pnodes.find(node => node.id == url)
        if (node) {
            node.weight++
        }
    }
    async init(indexers) {
        const lib = await coinfly.create('bsv')
        const pkey = config.key ? await lib.getPublicKey(config.key) : "NotSet"
        this.thisNode = { key: pkey }
        this._isProducer = this.isProducer(pkey)
        this.indexers = indexers
        this.nodeClient = new NodeClient()
        this.endpoint = config.server.publicUrl
        //if (!config.server.https) this.endpoint += ":" + config.server.port

        this.startNodeServer()
        await this.loadNodes(true)
        this.pullNewTxs()
        //await this.connectNodes()

        return true
    }
    startNodeServer() {
        if (!this.nodeServer) this.nodeServer = new NodeServer()
        this.nodeServer.start(this.indexers)
    }
    async _fromDNS() {
        return new Promise(resolve => {
            const domain = "nodes.nbdomain.com"
            dns.resolve(domain, "TXT", (err, data) => {
                let nodes = []
                for (let i = 0; i < data?.length; i++) {
                    const items = data[i][0].toLowerCase().split(',')
                    nodes = nodes.concat(items)
                }
                resolve(nodes)
            })
        })
    }
    async validatNode(url) {
        try {
            const res = await axios.get(url + "/api/nodeinfo")
            if (res.data && res.data.pkey) {
                return res.data
            }
        } catch (e) {
            console.error(url + ":" + e.message)
            return null
        }
    }
    incCorrect(key) {
        this.indexers.db.updateNodeScore(key, true)
    }
    incMistake(key) {
        this.indexers.db.updateNodeScore(key, false)
    }
    hasNode(url) {
        if (this.pnodes.find(item => item.id == url)) return true
        return false
    }
    removeNode(url) {
        // const index = this.pnodes.findIndex(item => item.id == url)
        // if (index != -1) this.pnodes.splice(index, 1)
        // delete this.nodeClients[url]
    }
    async addNode({ url, isPublic = true }) {
        //console.log(1, url)
        if (this.hasNode(url)) {
            //console.log(2, url)
            return false
        }
        //console.log(3, url)
        if (url.indexOf(this.endpoint) != -1) {
            //console.log(4, url)
            return false
        }
        const info = await this.validatNode(url)
        //console.log(5, url)
        if (!info) return false
        //console.log("adding node:", url)
        const node = { id: url, pkey: info.pkey, weight: 50, info: info }
        this.pnodes.push(node)
        if (isPublic) {
            this.notifyPeers({ cmd: "newNode", data: { url } })
            this.indexers.db.addNode({ url, info })
            if (objLen(this.nodeClients) < DEF.CONSENSUE_COUNT) {
                await this.connectOneNode(node)
            }
        }
        return true
    }
    async loadNodes() {
        const self = this;
        const _addFromArray = async function (nodes) {
            if (!Array.isArray(nodes)) return
            for (const node of nodes) {
                await self.addNode({ url: node.url ? node.url : node })
                if (self.pnodes.length >= DEF.CONSENSUE_COUNT) break;
            }
        }
        if (config.pnodes) {
            await _addFromArray(config.pnodes)
        } else {
            const nodes = this.indexers.db.loadNodes(true) //load from db
            await _addFromArray(nodes)
            if (objLen(this.nodeClients) < DEF.CONSENSUE_COUNT) { //load from DNS
                const p = await this._fromDNS()
                await _addFromArray(p)
            }
        }
    }
    isProducer(pkey) {
        if (!pkey) return this._isProducer
        if (config.disableProducer) return false
        return CONSTS.producers.indexOf(pkey) != -1
    }
    onNodeDisconnect(node) {
        this.removeNode(node.id)
    }
    async connectOneNode(node) {
        if (this.nodeClients[node.id]) {
            //disconnect lastone
        }
        if (!this.isProducer(node.pkey)) {
            return false
        }
        const client = new NodeClient(this.indexers, config.server.publicUrl);
        if (await client.connect(node)) {
            console.log("connected to:", node.id)
            this.nodeClients[node.id] = client
            return true
        }
        console.error("failed to connect:", node.id)
        return false
    }
    getNodes() {
        return this.pnodes
    }
    async listAllNodes() {
        if (this.isProducer()) {
            return this.getNodes()
        }
        try {
            const url = this.pnodes[0].id + "/api/nodes"
            const res = await axios.get(url)
            return res.data ? res.data : []
        } catch (e) {
            console.log(e)
        }
        return []
    }

    async notifyPeers({ cmd, data }) {
        if (this.nodeServer) {
            this.nodeServer.notify({ cmd, data })
        }
    }
    getConnectedClients() {
        let connected_clients = []
        for (const id in this.nodeClients) {
            const client = this.nodeClients[id]
            if (client.connected) connected_clients.push(client)
        }
        return connected_clients
    }
    async sendNewTx(obj) {
        if (this.nodeClients && Object.keys(this.nodeClients).length > 0) {
            const clients = this.getConnectedClients()
            if (clients.length > 0) {
                const ret = await clients[0].sendNewTx(obj)
                /*if (ret && clients.length > 1) { //one node return success, send through another node, make sure it's sent
                    clients[1].sendNewTx(obj)
                }*/
                return ret
            }
        }
        console.error("No Other nodes connected, cannot send tx. ", this.nodeClients)
        return { code: 1, msg: "No Other nodes connected, cannot send tx" }
    }
    async verifySigs({ txTime, txid, sigs }) {
        const { Util } = this.indexers
        if (txTime >= 1659689820) { //chect sigs from other node after this time
            if (!sigs) return false
            if (typeof sigs === 'string')
                sigs = Util.parseJson(sigs)
            for (const key in sigs) {
                if (!this.isProducer(key) || await Util.bitcoinVerify(key, txid, sigs[key]) == false) {
                    console.error("sig verify failed:", sigs)
                    return false
                }
            }
        }
        return true
    }
    async getConfirmations(txids, min) {
        let ret = []
        for (const client of this.getConnectedClients()) {
            const ret1 = await client.getConfirmations(txids)
            const ret2 = ret1.filter(item => {
                const sigs = JSON.parse(sigs)
                if (Object.keys(sigs).length >= min) {
                    ret.push(item)
                    return false
                } else {
                    return true
                }
            })
            if (ret2.length == 0) break;
            txids = ret2
        }
        return ret
    }
    async getTx(txid, from) {
        try {
            if (from) {
                const res = await axios.get(`${from}/api/p2p/gettx?txid=${txid}`)
                if (res.data.tx) {
                    return res.data
                }
            }
        } catch (e) { console.error("getTx:", e.message) }
        for (const node of this.getNodes()) {
            if (node.id == from) continue
            const url = node.id + "/api/p2p/gettx?txid=" + txid
            try {
                const res = await axios.get(url)
                if (res.data) {
                    if (res.data.tx) return res.data
                }
            } catch (e) { console.error("getTx:", e.message) }
        }
        return null
    }

    async getData(hash, option = { string: true }) {
        if (hash == 'undefined') {
            console.log("found")
        }
        for (const node of this.getNodes(false)) {
            const url = node.id + "/api/p2p/getdata?hash=" + hash + "&string=" + option.string
            try {
                const res = await axios.get(url)
                if (res.data && res.data.code == 0) {
                    return res.data
                }
            } catch (e) {
                console.error("getData:err getting from:", url, e.code, e.message)
            }
        }
        return {}
    }
    canResolve() {
        return this._canResolve
    }
    async startTxSync(indexers) {
        this.indexers = indexers
    }
    async pullNewTxs() {
        while (true) {
            for (const id in this.nodeClients) {
                if (this.nodeClients[id].connected)
                    this.nodeClients[id].pullNewTxs();
            }
            await wait(1000 * 60)
        }
    }
    static inst() {
        if (g_node == null) {
            g_node = new Nodes()
        }
        return g_node
    }
}
module.exports.Nodes = Nodes.inst()