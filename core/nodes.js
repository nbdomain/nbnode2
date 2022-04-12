const Parser = require('./parser')
const config = require('./config').CONFIG
const axios = require('axios')
const rwc = require("random-weighted-choice")
var dns = require("dns");
let node = null
class Nodes {
    constructor() {
        this.nodes = []
    }
    async sleep(seconds) {
        return new Promise(resolve => {
            setTimeout(resolve, seconds * 1000);
        })
    }
    async selectNode(nodes, count = 1) {
        return new Promise(async resolve => {
            let i = 1, selected_nodes = [], j = 1;
            for (const node of nodes) {
                axios.get(node + "/api/p2p/ping").then(res => {
                    if (res.data && res.data.msg == "pong") {
                        selected_nodes.push(node)
                        ++i
                    }
                }).catch(e => {
                    console.log(e)
                }).finally(() => j++)
            }
            while (i <= count && j <= nodes.length) {
                await this.sleep(1)
            }
            resolve(selected_nodes.length == 0 ? [] : selected_nodes)
        })
    }
    get() {
        const node = rwc(this.nodes)
        //log("choose:",node)
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
    async init() {
        this.endpoint = (config.server.https ? "https://" : "http://") + config.server.domain
        if (!config.server.https) this.endpoint += ":" + config.server.port
        await this.refreshPeers(true)
        return true
    }
    async _fromDNS() {
        return new Promise(resolve => {
            const domain = "nodes.nbdomain.com"
            dns.resolve(domain, "TXT", (err, data) => {
                //console.log(data)
                let nodes = []
                for (let i = 0; i < data?.length; i++) {
                    const items = data[i][0].toLowerCase().split(',')
                    nodes = nodes.concat(items)
                }
                resolve(nodes)
            })
        })
    }
    async refreshPeers(onlyLocal = false) {
        const port = config.server.port
        let peers2test = []
        if (!onlyLocal) {
            try {
                const res = await axios.get("http://localhost:" + port + "/api/queryKeys?tags=nbnode")
                if (res.data && res.data.length > 0) {
                    //peers2test = res.data
                }
            } catch (e) { }
        }
        if (config.peers.length)
            peers2test = peers2test.concat(config.peers)
        const p = await this._fromDNS()
        peers2test = peers2test.filter(item => item.indexOf(config.server.domain) == -1)
        //this.peers = await this.selectNode(peers2test,50)
        const peers = new Set(peers2test)
        for (const node of peers) {
            if (this.nodes.find(item => item.id == node)) continue;
            console.log("Adding node:", node)
            this.nodes.push({ id: node, weight: 50 })
        }
        //console.log(`found ${this.peers.length} peers`)

        setTimeout(this.refreshPeers.bind(this), 60000)
    }
    getNodes() {
        return this.nodes
    }
    async notifyPeers({ cmd, data }) {
        for (const peer of this.nodes) {
            const url = peer.id + "/api/p2p/" + cmd + "?data=" + (data) + "&&from=" + (this.endpoint)
            try {
                axios.get(url)
            } catch (e) {
                console.log("error getting: ", url)
            }
        }
    }
    async getTx(txid, chain) {
        for (const node of this.getNodes()) {
            const url = node.id + "/api/p2p/gettx?txid=" + txid + "&chain=" + chain
            const res = await axios.get(url)
            if (res.data) {
                if (res.data.code == 0) return res.data.rawtx
            }
        }
        return null
    }
    async getData(txid, chain) {
        for (const node of this.getNodes()) {
            const url = node.id + "/api/p2p/gettx?txid=" + txid + "&chain=" + chain
            const res = await axios.get(url)
            if (res.data && res.data.code == 0 && chain == 'ar') {
                const d = JSON.parse(res.data.rawtx)
                if (d.data) return d.data
            }
        }
        return null
    }
    async getOData(hash, option = { string: true }) {
        for (const node of this.getNodes()) {
            const url = node.id + "/api/p2p/getdata?hash=" + hash + "&string=" + option.string
            const res = await axios.get(url)
            if (res.data && res.data.code == 0) {
                return res.data
            }
        }
        return {}
    }
    async _syncFromNode(indexer, fullSync, chain) {
        const latestTime = fullSync ? indexer.database.getLastFullSyncTime(chain) : indexer.database.getLatestTxTime(chain)
        let affected = 0
        if (fullSync) {
            console.log(chain + ": perform full sync check...")
        }
        for (const node of this.getNodes()) {
            const apiURL = node.id
            const url = apiURL + "/api/queryTX?from=" + latestTime + "&chain=" + chain
            if (fullSync) {
                const dataCount = indexer.database.getDataCount()
                const url1 = apiURL + "/api/dataCount"
                try {
                    const res = await axios.get(url1)
                    if (res.data) {
                        if (dataCount[chain] >= res.data[chain]) continue;
                        console.log(`Need sync. self ${chain} count:${dataCount[chain]},${apiURL} count:${res.data[chain]}`)
                        fullSyncDone = true
                    }
                } catch (e) {
                    continue
                }
            }
            try {
                const res = await axios.get(url)
                for (const tx of res.data) {
                    let oData = null
                    if (tx.oDataRecord) oData = tx.oDataRecord.raw
                    const ret = await (Parser.get(chain).parseRaw({ rawtx: tx.rawtx, oData: oData, height: tx.height }));
                    if (ret && ret.code == 0) {
                        console.log("syncFromNode: Adding ", tx.txid)
                        affected++
                        if (tx.oDataRecord) {
                            const item = tx.oDataRecord
                            indexer.database.saveData({ data: item.raw, owner: item.owner, time: item.time })
                        }
                        indexer.add(tx.txid, tx.rawtx, tx.height, tx.time)
                    }
                }
            } catch (e) {
                console.error("syncFromNode " + apiURL + ": " + e.message)
            }
        }
        if (fullSync && affected > 0) {
            const time = Math.floor(Date.now() / 1000).toString()
            indexer.database.saveLastFullSyncTime(time, chain)
        }
        return affected
    }
    async FullSyncFromNodes(indexers) {
        let affected = await this._syncFromNode(indexers.bsv, true, 'bsv')
        let affected1 = await this._syncFromNode(indexers.ar, true, 'ar')
        if (affected + affected1 > 0) {
            indexers.db.resetDB("domain")
        }
    }
    async startTxSync(indexers) {
        await this._syncFromNode(indexers.bsv, false, 'bsv')
        await this._syncFromNode(indexers.ar, false, 'ar')
        await this.FullSyncFromNodes(indexers)
        setTimeout(this.startTxSync.bind(this, indexers), 1000 * 60 * 10)
    }
    static inst() {
        if (node == null) {
            node = new Nodes
        }
        return node
    }
}
module.exports = Nodes.inst()