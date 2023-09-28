const axios = require('axios')
const coinfly = require('coinfly')
const rwc = require("random-weighted-choice")
var dns = require("dns");
const { NodeServer, NodeClient, rpcHandler } = require('./nodeAPI');
const { DEF } = require('./def');
const { Util } = require('./util');
const path = require('path')
const fs = require('fs');
const { resourceLimits } = require('worker_threads');
const NtpTimeSync = require("ntp-time-sync").NtpTimeSync
dnsPromises = dns.promises;





let wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let objLen = obj => { return obj ? Object.keys(obj).length : 0 }
let g_node = null

class Node {
    constructor(url, indexers) {
        this.url = url
        this.indexers = indexers
    }
    async validate() {
        try {
            const { config } = this.indexers
            if (!config.nodeIPs) config.nodeIPs = []
            const pURL = new URL(this.url)
            const IP = await dnsPromises.lookup(pURL.hostname);
            IP && config.nodeIPs.push(IP.address)
            const res = await axios.get(this.url + "/api/nodeinfo")
            if (res.data && res.data.pkey) {
                this.info = res.data
                return res.data
            }
        } catch (e) {
            console.error(this.url + ":" + e.message)
        }
        return false
    }
    getKey() {
        return this.info ? this.info.pkey : null
    }
    async pullNewTxs({ thisKeyCount }) {
        const { db, indexer, config } = this.indexers
        const checkpointTime = +db.readConfig("dmdb", "checkpointTime") || 1679550531480
        let lastTime = +db.readConfig('dmdb', this.url + "_lasttime") || 1682151503790
        //if (lastTime < checkpointTime) lastTime = checkpointTime
        const url = this.url + "/api/p2p/getNewTx/"
        try {
            const res = await axios.get(url, { params: { v: 1, from: config.server.publicUrl, fromTime: lastTime } })
            if (res.data) {
                const result = res.data
                console.log("reply from:", url, "newtx:", result?.data?.length, " domains:", result.domains, " keys:", result.keys, " dmHash:", result.dmHash)
                if (!result.data) {
                    return result
                }
                if (res.keys - thisKeyCount > 5000) {
                    return { code: 2, dmHash: res.dmHash, keys: res.keys, domains: res.domains }
                }
                for (const tx of result.data) {
                    if (!tx.oDataRecord.raw) {
                        tx.oDataRecord = Util.parseJson(tx.odata)
                    }
                    await indexer.addTxFull({ txid: tx.txid, sigs: tx.sigs, rawtx: tx.rawtx, oDataRecord: tx.oDataRecord, time: tx.time, txTime: tx.txTime, chain: tx.chain })
                    this.maxTime = Math.max(this.maxTime || 0, tx.txTime)
                }
                if (this.maxTime)
                    db.writeConfig('dmdb', this.url + "_lasttime", this.maxTime + '')
                delete result.data
                result.code = 0
                return result
            }
        } catch (e) {
            return { code: 4, msg: e.message }
        }

    }

}
class Nodes {
    constructor() {
        this.pnodes = {}
        this._canResolve = true
        this.nodeClients = {}
        //this.isProducer = config.server.producer
    }
    async checkTime() {
        const { logger } = this.indexers
        try {
            const timeSync = NtpTimeSync.getInstance({ replyTimeout: 10000 });
            const result = await timeSync.getTime();
            console.log("real time", result.now);
            console.log("offset in milliseconds", result.offset);
            if (Math.abs(result.offset) > 2000) {
                logger.error("OS time is not in sync with NTP, please resync")
                return false
            }
            return true
        } catch (e) {
            logger.error("checkTime:", e.message)
        }
    }
    async sleep(seconds) {
        return new Promise(resolve => {
            setTimeout(resolve, seconds * 1000);
        })
    }
    nodeFromKey(key) {
        //        console.log(JSON.stringify(this.pnodes))
        return this.pnodes[key]
    }

    async start(indexers) {
        this.indexers = indexers
        const { config, dataFolder, logger } = indexers
        indexers.resolver.addController(this)
        const lib = await coinfly.create('bsv')
        let privateKey = process.env.nodeKey
        if (!privateKey) {
            try {
                var data = fs.readFileSync(dataFolder + 'node.key', 'utf8');
                privateKey = data.toString()
            } catch (e) {
                privateKey = await lib.createPrivateKey()
                fs.writeFileSync(dataFolder + 'node.key', privateKey)
            }
        }
        config.key = privateKey
        const pkey = config.key ? await lib.getPublicKey(privateKey) : "NotSet"
        this.thisNode = { key: pkey }
        this._isProducer = this.isProducer(pkey)
        this.checkTime()
        this.indexers = indexers
        this.endpoint = config.server.publicUrl
        await this.loadNodes(true)
        if (!indexers.clusterNumber || indexers.clusterNumber === "0") {
            this.startLoop()
        }

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
    incCorrect(url) {
        this.indexers.db.updateNodeScore(url, true)
    }
    incMistake(url) {
        this.indexers.db.updateNodeScore(url, false)
    }
    hasNode(url) {
        return this.pnodes[url] ? true : false
    }
    removeNode(url) {
        // const index = this.pnodes.findIndex(item => item.id == url)
        // if (index != -1) this.pnodes.splice(index, 1)
        // delete this.nodeClients[url]
        delete this.handling[url]
    }
    async addNode({ url, isPublic = true }) {
        const { config } = this.indexers
        if (!this.handling) this.handling = {}
        url = url.trim()
        if (this.handling[url]) {
            console.error("handled:", url)
            return false
        }
        this.handling[url] = true
        if (this.endpoint && url.indexOf(this.endpoint) != -1) {
            console.error(url, "self")
            return true
        }
        const node = new Node(url, this.indexers)
        const self = this
        node.validate().then((result) => {
            if (!result) {
                self.incMistake(url)
            }
            if (result && !self.pnodes[url]) {
                console.log("added node:", url)
                self.pnodes[url] = node
                if (isPublic) {
                    self.notifyPeers({ cmd: "newNode", data: { url } })
                    self.indexers.db.addNode({ url, result })
                }
            }
        })
        return true
    }
    async loadNodes() {
        const { cfg_chain } = this.indexers
        const self = this;
        const _addFromArray = async function (nodes) {
            if (!Array.isArray(nodes)) return
            for (const node of nodes) {
                const url = node.url ? node.url : node
                const result = await self.addNode({ url })
            }
        }
        if (cfg_chain.pnodes) {
            await _addFromArray(cfg_chain.pnodes)
        }
        // const nodes = this.indexers.db.loadNodes(true) //load from db
        // await _addFromArray(nodes)
        const p = await this._fromDNS()
        await _addFromArray(p)

    }
    isProducer(pkey) {
        const { cfg_chain } = this.indexers
        if (cfg_chain?.consensus?.mode === 'trust_all') return true
        if (!pkey) return this._isProducer
        if (cfg_chain.disableProducer) return false
        return cfg_chain.producers.indexOf(pkey) != -1
    }
    onNodeDisconnect(node) {
        this.removeNode(node.id)
    }
    async connectAsClient(node) {
        const { config, logger } = this.indexers

        if (this.nodeClients[node.id]) {
            console.log("already connected, ignore:", node.id)
            return false
        }
        if (!this.isProducer(node.pkey) && objLen(this.nodeClients) > 0) {
            return false
        }
        const client = new NodeClient(this.indexers, config.server.publicUrl);
        if (await client.connect(node)) {
            logger.info("connected to:", node.id)
            this.nodeClients[node.id] = client
            return true
        }
        console.error("failed to connect:", node.id)
        return false
    }
    getNodes() {
        return this.pnodes || {}
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
    }
    async downloadAndUseDomainDB(from, includingTxDB = true) {
        const orgCanResolve = this._canResolve
        try {
            const { db, logger } = this.indexers
            this._canResolve = false
            const url = from + "/files/bk_domains.db"
            const filename = path.join(db.path, "d_domains.db")
            const res = await axios.get(from + "/api/p2p/backup") //ask node to backup the latest db
            if (res.data.code !== 0) {
                this._canResolve = orgCanResolve
                return false
            }
            logger.info("Downloading domain db from:", url)
            await Util.downloadFile(url, filename)
            logger.info("Download domain db successfully")
            this.indexers.resolver.abortResolve()
            this.indexers.db.restoreDomainDB(filename)
            //fs.unlinkSync(filename)
            /*if (includingTxDB) {
                const url = from + "/files/bk_txs.db"
                const filename = path.join(db.path, "d_txs.db")
                console.log("Downloading txdb from:", url)
                await Util.downloadFile(url, filename)
                console.log("Download txdb successful")
                this.indexers.db.restoreTxDB(filename)
                //fs.unlinkSync(filename)
            }*/
            this._canResolve = orgCanResolve
            return true
        } catch (e) {
            console.error(e.message)
        }
        this._canResolve = orgCanResolve
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
        for (const u in this.pnodes) {
            const node = this.pnodes[u]
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
        console.log("getting data, hash:", hash)
        for (const u in this.pnodes) {
            const node = this.pnodes[u]
            const url = node.url + "/api/p2p/getdata/?hash=" + hash + "&string=" + option.string
            try {
                const res = await axios.get(url)
                if (res.data && res.data.code == 0) {
                    const d = res.data
                    if (d.raw) {
                        //oData = d.raw
                        //await this.indexers.db.saveData({ data: d.raw, owner: d.owner, time: d.time, from: "nodes.js" })
                    }
                    console.log("got data from:", url)
                    return res.data
                }
            } catch (e) {
                console.error("getData:err getting from:", url, e.code, e.message)
            }
        }
        console.error("data not found, hash:", hash)
        return {}
    }
    canResolve() {
        return this._canResolve
    }
    getConsenseResult({ dmHashMap, thisDmHash, thisKeyCount }) {
        const { cfg_chain } = this.indexers
        const consenseStrategy = cfg_chain.consensus.strategy || 'mostKeys'
        for (const key in dmHashMap) {
            if (dmHashMap[key].length > DEF.CONSENSUE_COUNT / 2) {
                if (dmHashMap[key][0].keys >= thisKeyCount) {
                    return { result: (key === thisDmHash) ? 'win' : 'lose', node: dmHashMap[key][0].id }
                }
            }
        }
        return { result: "none" }
    }
    async startLoop() {
        const { config, db } = this.indexers
        if (config.consensus.mode === 'trust_all') {
            db.verifyDBFromPeers()
        }
        else
            this.pullNewTx()
    }
    async pullNewTx() {
        const { db } = this.indexers
        let counter = 0
        const thisKeyCount = db.getDataCount({ tx: false, domainKey: true }).keys
        this._canResolve = false
        const dmHashMap = {}
        let needDownload = false, mostKey = 0, mostUrl = null
        for (const url in this.pnodes) {
            const node = this.pnodes[url]
            const { code, dmHash, keys, domains, msg } = await node.pullNewTxs({ thisKeyCount });
            if (code === 2) { //too far away, download db file instead
                needDownload = true
            }
            if (code === 3) {
                console.error(url, " timeout")
                continue; //timeout
            }
            if (dmHash) {
                if (!dmHashMap[dmHash]) dmHashMap[dmHash] = []
                dmHashMap[dmHash].push({ url, keys })
            }
            console.log("<==========getNewTx finish:", url, "code:", code, "msg:", msg)
            if (keys > mostKey) {
                mostKey = keys, mostUrl = url
                console.log("mostKey:", mostKey, "mostUrl:", mostUrl)
            }
        }
        if (needDownload) {
            await this.downloadAndUseDomainDB(mostUrl)
            this._canResolve = true
        }
        const thisDmHash = db.getDomainHash()
        !dmHashMap[thisDmHash] && (dmHashMap[thisDmHash] = [])
        dmHashMap[thisDmHash].push({ id: 'myself', keys: thisKeyCount })
        console.log("After update:", JSON.stringify(dmHashMap, undefined, 2))
        const ret = this.getConsenseResult({ dmHashMap, thisDmHash, thisKeyCount })
        const now = Date.now()
        if (ret.result === 'win') { //got consens
            if (!this.backupTime) this.backupTime = now
            const span = now - this.backupTime || 0
            console.log("I win, time:", span)
            if (span > 60 * 1000) { //60 seconds
                db.backupDB()
                this.backupTime = Date.now()
            }
            this.loseTime = now
        }
        if (ret.result === 'lose') {
            if (!this.loseTime) this.loseTime = now
            const span = now - this.loseTime || 0
            console.log("I lose, time:", span)
            if (span > 120 * 1000) { //120 seconds
                await this.downloadAndUseDomainDB(ret.node)
                this.backupTime = Date.now()
                this.loseTime = Date.now()
            }
        }
        this._canResolve = true
        counter++ > 10000 ? (counter = 0) : null
        if (counter % 6 === 0) { //every 1 minute
            db.compactTxDB()
        }
        if (counter % 60 === 0) { //every 10 minutes
            db.backupDB()
        }
        // await wait(1000 * 10)
        setTimeout(this.pullNewTx.bind(this), 1000 * 5)
    }
    static inst() {
        if (g_node == null) {
            g_node = new Nodes()
        }
        return g_node
    }
}
module.exports.Nodes = Nodes.inst()