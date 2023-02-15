const axios = require('axios')
const coinfly = require('coinfly')
const rwc = require("random-weighted-choice")
var dns = require("dns");
const { NodeServer, NodeClient, rpcHandler } = require('./nodeAPI');
const { DEF } = require('./def');
const { Util } = require('./util');
const path = require('path')
const fs = require('fs');
const NtpTimeSync = require("ntp-time-sync").NtpTimeSync



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
    async checkTime() {
        const timeSync = NtpTimeSync.getInstance({ replyTimeout: 10000 });
        const result = await timeSync.getTime();
        console.log("real time", result.now);
        console.log("offset in milliseconds", result.offset);
        if (Math.abs(result.offset) > 2000) {
            console.error("OS time is not in sync with NTP, please resync")
            return false
        }
        return true
    }
    async sleep(seconds) {
        return new Promise(resolve => {
            setTimeout(resolve, seconds * 1000);
        })
    }
    nodeFromKey(key) {
        //        console.log(JSON.stringify(this.pnodes))
        return this.pnodes.find(item => item.pkey === key)
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
    async start(indexers) {
        this.indexers = indexers
        const { config } = indexers
        indexers.resolver.addController(this)
        const lib = await coinfly.create('bsv')
        const pkey = config.key ? await lib.getPublicKey(config.key) : "NotSet"
        this.thisNode = { key: pkey }
        this._isProducer = this.isProducer(pkey)
        if (this.isProducer() && !this.checkTime()) {
            return false
        }
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
        const { config } = this.indexers
        return new Promise(resolve => {
            const domain = `nodes_${config.chainid}.nbdomain.com`
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
            const { config } = this.indexers
            const res = await axios.get(url + "/api/nodeinfo")
            if (res.data && res.data.pkey) {
                if (!config.nodeIPs) config.nodeIPs = []
                config.nodeIPs.push(res.request.socket.remoteAddress)
                return res.data
            }
        } catch (e) {
            console.error(url + ":" + e.message)
            return null
        }
    }
    incCorrect(url) {
        this.indexers.db.updateNodeScore(url, true)
    }
    incMistake(url) {
        this.indexers.db.updateNodeScore(url, false)
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
        const { config } = this.indexers
        if (!this.handling) this.handling = {}
        if (this.handling[url]) {
            console.error("handled:", url)
            return false
        }
        this.handling[url] = true
        if (this.endpoint && url.indexOf(this.endpoint) != -1) {
            console.error(url, "self")
            return true
        }
        const info = await this.validatNode(url)
        //console.log(5, url)
        if (!info) {
            console.error("can't get info from:", url)
            return false
        }
        if (info.chainid != config.chainid) {
            console.error('different chainId:', info.chainid)
            return false
        }
        if (info.pkey === this.thisNode.key) { //self
            return false
        }
        if (this.hasNode(url)) {
            console.error(url, "exists")
            return true
        }
        const node = { id: url, pkey: info.pkey, weight: 50, info: info }
        this.pnodes.push(node)
        console.log("added node:", url)
        if (isPublic) {
            this.notifyPeers({ cmd: "newNode", data: { url } })
            this.indexers.db.addNode({ url, info })
            await this.connectAsClient(node)
        }
        return true
    }
    async loadNodes() {
        const { config } = this.indexers
        const self = this;
        const _addFromArray = async function (nodes) {
            if (!Array.isArray(nodes)) return
            for (const node of nodes) {
                const url = node.url ? node.url : node
                const result = await self.addNode({ url })
                if (!result)
                    self.incMistake(url)
                if (self.pnodes.length >= DEF.CONSENSUE_COUNT) break;
            }
        }
        const requiredNode = this.isProducer() ? DEF.CONSENSUE_COUNT : 1
        if (config.pnodes) {
            await _addFromArray(config.pnodes)
        }
        if (objLen(this.nodeClients) < requiredNode) {
            const nodes = this.indexers.db.loadNodes(true) //load from db
            await _addFromArray(nodes)
        }
        if (objLen(this.nodeClients) < requiredNode) { //load from DNS
            const p = await this._fromDNS()
            await _addFromArray(p)
        }

    }
    isProducer(pkey) {
        const { config, CONSTS } = this.indexers
        if (!pkey) return this._isProducer
        if (config.disableProducer) return false
        return CONSTS.producers.indexOf(pkey) != -1
    }
    onNodeDisconnect(node) {
        this.removeNode(node.id)
    }
    async connectAsClient(node) {
        const { config } = this.indexers

        if (this.nodeClients[node.id]) {
            console.log("already connected, ignore:", node.id)
            return false
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

    async notifyPeers({ id, cmd, data }) {
        if (this.nodeServer) {
            this.nodeServer.notify({ id, cmd, data })
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
        return await rpcHandler.handleNewTxFromApp({ indexers: this.indexers, obj })
        /*const { Parser } = this.indexers
        let ret = await Parser.parseTX({ rawtx: obj.rawtx, oData: obj.oData, newTx: true, chain: obj.chain });
        if (ret.code != 0 || !ret.rtx.output || ret.rtx.output.err) {
            console.error("parseRaw error err:", ret)
            return { code: -1, message: ret.msg }
        }
        if (this.nodeClients && Object.keys(this.nodeClients).length > 0) {
            const clients = this.getConnectedClients()
            if (clients.length > 0) {
                const ret = await clients[0].sendNewTx(obj)
                if (ret && clients.length > 1) { //one node return success, send through another node, make sure it's sent
                    clients[1].sendNewTx(obj)
                }
                console.log(ret)
                return ret
            }
        }
        console.error("No Other nodes connected, cannot send tx. ", this.nodeClients)
        return { code: 1, msg: "No Other nodes connected, cannot send tx" } */
    }
    async downloadAndUseDomainDB(from, includingTxDB = true) {
        try {
            const { db, logger } = this.indexers
            this._canResolve = false
            if (!from) {
                const clients = this.getConnectedClients()
                if (clients.length == 0) {
                    console.error("no connected client")
                    return false
                }
                from = clients[0].node.id
            }
            /*if (includingTxDB) {
                const url = from + "/files/bk_txs.db"
                const filename = path.join(db.path, "d_txs.db")
                console.log("Downloading txdb from:", url)
                await Util.downloadFile(url, filename)
                console.log("Download txdb successful")
                this.indexers.db.restoreTxDB(filename)
                fs.unlinkSync(filename)
            }*/
            const url = from + "/files/bk_domains.db"
            const filename = path.join(db.path, "d_domains.db")
            logger.info("Downloading domain db from:", url)
            await Util.downloadFile(url, filename)
            logger.info("Download domain db successfully")
            this.indexers.resolver.abortResolve()
            this.indexers.db.restoreDomainDB(filename)
            fs.unlinkSync(filename)

            this._canResolve = true
            return true
        } catch (e) {
            console.error(e.message)
        }
        this._canResolve = true
        return false
    }
    async verifySigs({ txTime, txid, sigs }) {
        const { Util } = this.indexers
        if (txTime >= 1659689820) { //chect sigs from other node after this time
            if (!sigs) return false
            if (typeof sigs === 'string')
                sigs = Util.parseJson(sigs)

            for (const key in sigs) {
                if (this.isProducer(key) && await Util.bitcoinVerify(key, txid, sigs[key])) {
                    return true
                }
            }
            return false
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
        for (const node of this.getNodes(false)) {
            const url = node.id + "/api/p2p/getdata?hash=" + hash + "&string=" + option.string
            try {
                const res = await axios.get(url)
                if (res.data && res.data.code == 0) {
                    const d = res.data
                    if (d.raw) {
                        //oData = d.raw
                        await this.indexers.db.saveData({ data: d.raw, owner: d.owner, time: d.time, from: "nodes.js" })
                    }
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
    async pullNewTxs() {
        const { db } = this.indexers
        while (true) {
            const block = db.getLastBlock()
            if (block && block.height > 100) {
                for (const id in this.nodeClients) {
                    if (this.nodeClients[id].connected)
                        this.nodeClients[id].pullNewTxs();
                }
            }
            await wait(1000 * 10)
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