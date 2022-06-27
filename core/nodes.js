const config = require('./config').CONFIG
const axios = require('axios')
const rwc = require("random-weighted-choice")
var dns = require("dns");
const { timeStamp } = require('console');
const { NodeServer, NodeClient, rpcHandler } = require('./nodeAPI');
const { threadId } = require('worker_threads');
//const Peer = require('peerjs-on-node')
let g_node = null
class Nodes {
    constructor() {
        this.nodes = []
        this.snodes = []
        this._canResolve = true
        this.isSuperNode = config.isProducer
    }
    async sleep(seconds) {
        return new Promise(resolve => {
            setTimeout(resolve, seconds * 1000);
        })
    }

    get(isSuper = true) {
        const node = isSuper ? rwc(this.snodes) : rwc(this.nodes)
        return node
    }
    cool(url) {
        const node = this.nodes.find(node => node.id == url)
        if (node) {
            node.weight--
        }
    }
    warm(url) {
        const node = this.nodes.find(node => node.id == url)
        if (node) {
            node.weight++
        }
    }
    async init(indexers) {
        this.indexers = indexers
        this.nodeClient = new NodeClient()
        this.endpoint = (config.server.https ? "https://" : "http://") + config.server.domain
        if (!config.server.https) this.endpoint += ":" + config.server.port
        await this.getSuperNodes(true)
        await this.connectSuperNode()
        return true
    }
    startNodeServer(httpServer) {
        if (!this.isSuper()) {
            console.error("Not super node")
            return false
        }
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
    isSuper() {
        //return true
        return this.isSuperNode
    }
    async validatNode(url, isSuper) {
        try {
            const res = await axios.get(url + "/api/nodeinfo")
            if (res.data && (!isSuper || res.data.pkey)) {
                return res.data
            }
        } catch (e) {
            console.error(url + ":" + e.message)
            return null
        }
    }
    hasNode(url) {
        if (this.nodes.find(item => item.id == url) || this.snodes.find(item => item.id == url)) return true
        return false
    }
    async addNode({ url, isSuper = true, isPublic = true }) {
        if (this.hasNode(url)) {
            console.log("node already added:", url)
            return false
        }
        if (url.indexOf(config.server.domain) != -1) return false
        const res = await this.validatNode(url, isSuper)
        if (!res) return false
        const nodes = isSuper ? this.snodes : this.nodes
        if (isSuper) this.snodes.push({ id: url, pkey: res.pkey, weight: 50 })
        this.nodes.push({ id: url, pkey: res.pkey, weight: isSuper ? 50 : 20 })
        if (isPublic) {
            this.notifyPeers({ cmd: "newNode", data: { url } })
        }
    }
    async getSuperNodes(onlyLocal = false) {
        const port = config.server.port
        this.nodes = [], this.snodes = []
        let localPeers = config.peers
        //get super nodes from DNS
        const p = await this._fromDNS()
        for (const item of p) {
            await this.addNode({ url: item, isSuper: true })
            if (item.indexOf(config.server.domain) != -1) this.isSuperNode = true
        }
        //local nodes
        localPeers.forEach(async item => { await this.addNode({ url: item, isSuper: false }) })

        //setTimeout(this.refreshPeers.bind(this), 60000)
    }
    async connectOneNode(node) {
        if (!this.nodeClients) this.nodeClients = {}
        if (this.nodeClients[node.id]) {
            //disconnect lastone
        }
        const client = new NodeClient(this.indexers, config.server.domain);
        if (await client.connect(node)) {
            console.log("connected to:", node.id)
            this.nodeClients[node.id] = client
            return true
        }
        console.error("failed to connect:", node.id)
        return false
    }
    async fastestNode(nodes) {
        return new Promise(resolve => {
            for (const node of nodes) {
                try {
                    axios.get(node.id + "/api/nodeInfo").then(res => {
                        if (res.data && res.data.pkey) {
                            resolve(node)
                            return
                        }
                    })
                } catch (e) { console.error("fastestNode:", e.message) }
            }
        })


    }
    async connectSuperNode() {
        //this.isSuperNode = true
        if (!this.isSuperNode) {
            const node = await this.fastestNode(this.snodes)
            await this.connectOneNode(node)
        } else {
            for (const node of this.snodes) {
                if (await this.connectOneNode(node)) {
                    if (!this.isSuperNode)
                        return true
                }
            }
        }
        if (!this.nodeClients || Object.keys(this.nodeClients).length == 0) {
            console.error("cannot connect to any super node")
            return false
        }
        return true
    }
    getNodes(isSuper = true) {
        return isSuper ? this.snodes : this.nodes
    }

    async notifyPeers({ cmd, data }) {
        if (this.nodeServer)
            this.nodeServer.notify({ cmd, data })
    }
    async sendNewTx(obj) {
        if (this.nodeClients && Object.keys(this.nodeClients).length > 0) {
            //return rpcHandler.handleNewTxFromApp({ indexers: this.indexers, obj })
            return await this.nodeClients[Object.keys(this.nodeClients)[0]].sendNewTx(obj)
        }
        console.error("No Other nodes connected, cannot send tx")
        return { code: 1, msg: "No Other nodes connected, cannot send tx" }
    }
    async getTx(txid, from, chain) {
        try {
            const res = await axios.get(`${from}/api/p2p/gettx?txid=${txid}`)
            if (res.data) {
                if (res.data.code == 0) return res.data
            }
        } catch (e) { e.error("getTx:", e.message) }
        for (const node of this.getNodes()) {
            if (node.id == from) continue
            const url = node.id + "/api/p2p/gettx?txid=" + txid
            try {
                const res = await axios.get(url)
                if (res.data) {
                    if (res.data.code == 0) return res.data
                }
            } catch (e) { e.error("getTx:", e.message) }
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
    async pullNewTxs(fullSync = false) {
        const { db } = this.indexers
        let latestTime = fullSync ? db.getLastFullSyncTime() : db.getLatestTxTime()
        for (const id in this.nodeClients) {
            await this.nodeClients[id].pullNewTxs({ from: latestTime })
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