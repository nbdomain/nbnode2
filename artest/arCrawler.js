
const sup = require('superagent');
const rwc = require("random-weighted-choice")

class ArNodes {
    async _getPerrs(seeds) {
        return new Promise(resolve => {
            for (const seedURL of seeds) {
                if (!seedURL.startsWith("http")) seedURL = "http://" + seedURL
                sup.get(seedURL + "/peers").timeout(10000).then(res => {
                    if (res.ok) {
                        resolve(JSON.parse(res.text))
                    }
                })
            }
        })
    }
    async init(seeds) {
        const data = await this._getPerrs(seeds)
        this.nodes = []
        data.forEach(node => {
            if (!node.startsWith("http")) node = "http://" + node
            this.nodes.push({ id: node, weight: 10 })
        })
        //this.nodes.push({id:"https://arweave.net",weight:2})
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
}
let counter = 0, all = 0
async function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve(), ms)
    })
}
let log = console.log
class ArClawer {
    async init(option) {
        let seeds = option?.seeds
        if(!option?.debug)log = ()=>{}
        if ( !seeds) seeds = ["https://arweave.net"]
        this.nodes = new ArNodes
        await this.nodes.init(seeds)
        setTimeout(this.getInfo.bind(this), 10000)
    }
    async getInfo() {
        const node = this.nodes.get()
        const url = node + "/info"
        const res = await sup.get(url).timeout(5000)
        if (res.ok) {
            this.maxHeight = JSON.parse(res.text).height
            return true
        }
        await this.getInfo()
    }
    async start(startHeight, endHeight, callback) {
        this.startHeight = startHeight
        this.endHeight = endHeight
        this._callback = callback
        await this.crawlBlock(startHeight)
    }
    async getTransaction(txid) {
        const node = this.nodes.get()
        const url = node + "/tx/" + txid
        //log("getting: "+url," level:",level)
        try {
            const res = await sup.get(url).timeout(5000)
            log("got tx from:", url, '---', counter++, '/', all)
            if (res.ok) {
                const data = JSON.parse(res.text)
                this.nodes.warm(node)
                return data
            }
        } catch (e) {
            //console.error("Error reading tx:", txid, " from url:", url)
        }
        this.nodes.cool(node)
        return await this.getTransaction(txid)
    }
    async getBlock(height) {
        const node = this.nodes.get()
        const url = node + "/block/height/" + height
        try {
            const res = await sup.get(url).timeout(5000)
            if (res.ok) {
                const data = JSON.parse(res.text)
                this.nodes.warm(node)
                log("got block:", height)
                return data
            }
        } catch (e) {
            // console.error("Error reading block:", height, " from url:", url)
        }
        this.nodes.cool(node)
        return await this.getBlock(height)
    }
    async doTransaction(txid){
        const tx = await this.getTransaction(txid)
        if (tx) {
            this._callback("tx", tx)
        }
    }
    async crawlTransactions(txids, height) {
        const batch = [];
        for (let i = 0; i < txids.length; i++) {
            const txid = txids[i];
            batch.push(this.doTransaction(txid, height));
        }
        await Promise.allSettled(batch);
    }
    async crawlBlock(height) {
        log("Crawling block:", height)
        const block = await this.getBlock(height)
        counter = 0, all = block.txs.length
        log("got block:", height, " txs:", block.txs.length)
        this._callback('block', block)
        await this.crawlTransactions(block.txs, height)
        while (height > this.maxHeight) {
            this._callback("status",{code:1,msg:"max height reached"})
            await sleep(600000)
        }
        if (height < this.endHeight || this.endHeight == 0) {
            await this.crawlBlock(height + 1)
        }
    }
}


module.exports = ArClawer