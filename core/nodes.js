const config = require('./config').CONFIG
const axios = require('axios')
const rwc = require("random-weighted-choice")
var dns = require("dns");
const { timeStamp } = require('console');
//const Peer = require('peerjs')
let g_node = null
class Nodes {
    constructor() {
        this.nodes = []
        this.snodes = []
        this._canResolve = true
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
    async init(parser) {
        this.parser = parser
        this.endpoint = (config.server.https ? "https://" : "http://") + config.server.domain
        if (!config.server.https) this.endpoint += ":" + config.server.port
        await this.refreshPeers(true)
        return true
    }
    startPeerServer() {
        if (!this.isSuper()) {
            console.error("Not super node")
            return false
        }
        var peer = new Peer(this.endpoint);
        peer.on('open', function (id) {
            console.log('My peer ID is: ' + id);
        });
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
        return true
        //return this.isSuperNode
    }
    async validatNode(url) {
        try {
            const res = await axios.get(url + "/api/p2p/ping")
            if (res.data) {
                return res.data
            }
        } catch (e) {
            return null
        }
    }
    async addNode(url, isSuper = true) {
        const res = await this.validatNode(url)
        if (!res) return
        var add = function (nodes) {
            if (nodes.find(item => item.id == url) || url.indexOf(config.server.domain) != -1) return false
            nodes.push({ id: url, token: res.token, weight: isSuper ? 50 : 20 })
        }
        isSuper ? (add(this.snodes), add(this.nodes)) : add(this.nodes)
    }
    async refreshPeers(onlyLocal = false) {
        const port = config.server.port
        this.nodes = [], this.snodes = []
        let localPeers = config.peers
        //get super nodes from DNS
        const p = await this._fromDNS()
        p.forEach(async item => {
            await this.addNode(item)
            if (item.indexOf(config.server.domain) != -1) this.isSuperNode = true
        })
        //local nodes
        localPeers.forEach(async item => { await this.addNode(item, false) })

        //setTimeout(this.refreshPeers.bind(this), 60000)
    }
    getNodes(isSuper = true) {
        return isSuper ? this.snodes : this.nodes
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

    async getTx(txid, from, chain) {
        try {
            const res = await axios.get(`${from}/api/p2p/gettx?txid=${txid}&chain=${chain}`)
            if (res.data) {
                if (res.data.code == 0) return res.data
            }
        } catch (e) { }
        for (const node of this.getNodes()) {
            if (node.id == from) continue
            const url = node.id + "/api/p2p/gettx?txid=" + txid + "&chain=" + chain
            try {
                const res = await axios.get(url)
                if (res.data) {
                    if (res.data.code == 0) return res.data
                }
            } catch (e) { }
        }
        return null
    }
    async getArData(txid, chain) {
        for (const node of this.getNodes()) {
            const url = node.id + "/api/p2p/gettx?txid=" + txid + "&chain=" + chain
            try {
                const res = await axios.get(url)
                if (res.data && res.data.code == 0 && chain == 'ar') {
                    const d = JSON.parse(res.data.rawtx)
                    if (d.data) return d.data
                }
            } catch (e) {
                console.error("getData:error getting from url:", url, e.code, e.message)
            }
        }
        return null
    }
    async getData(hash, option = { string: true }) {
        if (hash == 'undefined') {
            console.log("found")
        }
        for (const node of this.getNodes()) {
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
    async _syncFromNode(indexer, fullSync, chain) {
        let latestTime = fullSync ? indexer.database.getLastFullSyncTime(chain) : indexer.database.getLatestTxTime(chain)
        let affected = 0
        if (fullSync) {
            console.log(chain + ": perform full sync check...")
        }
        const dataCount = indexer.database.getDataCount()
        for (const node of this.getNodes()) {
            let apiURL = node.id
            if (fullSync) apiURL = this.get() //select based on weight
            console.log("Selected node:", apiURL)
            const url = apiURL + "/api/queryTX?from=" + latestTime + "&chain=" + chain
            let remoteData = 0
            if (fullSync) {
                const url1 = apiURL + "/api/dataCount"
                try {
                    const res = await axios.get(url1)
                    if (res.data) {
                        if (dataCount[chain] >= res.data[chain]) break;
                        remoteData = res.data[chain]
                        console.log(`Need sync. self ${chain} count:${dataCount[chain]},${apiURL} count:${res.data[chain]}`)
                    }
                } catch (e) {
                    console.error(url1 + ":", e.message)
                    this.cool(apiURL)
                    continue
                }
            }
            try {
                const res = await axios.get(url)
                let all = res.data.length
                for (const tx of res.data) {
                    if (await indexer.addTxFull({ txid: tx.txid, rawtx: tx.rawtx, oDataRecord: tx.oDataRecord, time: tx.txTime ? tx.txTime : tx.time, chain })) {
                        affected++;
                    }
                }
                if (fullSync && affected > 0) return affected
            } catch (e) {
                //console.log(e)
                console.error("syncFromNode " + apiURL + ": " + e.message)
                this.cool(apiURL)
            }
        }
        return affected
    }
    canResolve() {
        return this._canResolve
    }
    async FullSyncFromNodes(indexers) {
        this._canResolve = false
        let affected = await this._syncFromNode(indexers.bsv, true, 'bsv')
        let affected1 = await this._syncFromNode(indexers.ar, true, 'ar')
        const time = Math.floor(Date.now() / 1000).toString()
        if (affected > 0)
            indexers.db.saveLastFullSyncTime(time, 'bsv')
        if (affected1 > 0)
            indexers.db.saveLastFullSyncTime(time, 'ar')

        if (affected + affected1 > 0) {
            indexers.db.resetDB("domain")
        }
        this._canResolve = true
    }
    async startTxSync(indexers) {
        await this._syncFromNode(indexers.bsv, false, 'bsv')
        await this._syncFromNode(indexers.ar, false, 'ar')
        await this.FullSyncFromNodes(indexers)
        setTimeout(this.startTxSync.bind(this, indexers), 1000 * 60 * 10) //check data every 10 minutes
    }
    static inst() {
        if (g_node == null) {
            g_node = new Nodes()
        }
        return g_node
    }
}
module.exports.Nodes = Nodes.inst()