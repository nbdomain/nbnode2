const { DEF } = require('./def');
const { Util } = require('./util')
var stringify = require('json-stable-stringify');
const { default: axios } = require('axios');
const CONFIG = require('./config').CONFIG
let wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let objLen = obj => Object.keys(obj).length
class BlockMgr {
    constructor(indexers) {
        this.indexers = indexers
        this.nodePool = {}
        this.blockPool = {}
        this.height = 0
        this.uBlock = null //next unconfirmed block
        this.db = indexers.db
    }
    async createBlock(height, ntx = 10) {
        const db = this.db
        let preBlock = null, time = 0
        if (height > 0) {
            preBlock = db.getBlock(height - 1)
        }
        if (preBlock) {
            const lastTx = preBlock.txs[preBlock.txs.length - 1]
            time = lastTx.txTime
        }
        const txs = db.getTransactions({ time, limit: DEF.MAX_BLOCK_LENGTH })
        if (!txs || txs.length == 0) return null
        const merkel = await this.computeMerkel(txs)
        const block = { version: DEF.BLOCK_VER, height: height, merkel, txs, preHash: preBlock ? preBlock.hash : null }
        block.hash = await Util.dataHash(stringify(block))
        return block
    }
    async computeMerkel(txs) {
        let lastHash = null
        for (const tx of txs) {
            const hash = await Util.dataHash(tx.txid + tx.bytes.toString("hex") + tx.txTime)
            lastHash = lastHash ? await Util.dataHash(hash + lastHash) : hash
            delete tx.bytes
        }
        return lastHash
    }
    async onReceiveBlock(nodeKey, uBlock) {
        const { Nodes } = this.indexers
        const { block, sigs } = uBlock

        if (!this.nodePool[nodeKey]) this.nodePool[nodeKey] = { sigLen: 0 }

        let poolNode = this.nodePool[nodeKey]
        if (block.height === this.height) {
            console.log("found")
        }
        if (sigs && block.height === this.height && (!poolNode.sigLen || poolNode.sigLen < objLen(sigs))) {
            poolNode = this.nodePool[nodeKey]
            poolNode.sigLen = objLen(sigs)
            delete block.hash
            const hash = await Util.dataHash(stringify(block))
            block.hash = poolNode.hash = hash
            //check sender's sig
            const sigSender = sigs[nodeKey]
            if (await Util.bitcoinVerify(nodeKey, hash, sigSender) == false) return

            if (this.uBlock && this.uBlock.block.hash === hash) { //same as my block
                if (!sigs[Nodes.thisNode.key]) { //add my sig
                    const sig = await Util.bitcoinSign(CONFIG.key, hash)
                    sigs[Nodes.thisNode.key] = sig
                }
                if (objLen(this.uBlock.sigs) < objLen(sigs))
                    this.uBlock = uBlock
            }
        }
        this.nodePool[nodeKey].uBlock = uBlock
        // block && console.log("got new block:", block.height, block.hash, this.blockPool[block.hash]?.count, "from:", nodeKey)
    }
    async downloadBlocks(from, to, url) {

        try {
            console.log(`downloading block ${from}-${to} from: ${url}`)
            const res = await axios.get(url + `/api/getBlocks?from=${from}&&to=${to}`)
            if (res.data) {
                for (const blockItem of res.data) {
                    const block = { ...JSON.parse(blockItem.body), hash: blockItem.hash }
                    if (objLen(block.sigs) < DEF.CONSENSUE_COUNT) return false
                    const txs = this.db.getTransactions({ time: block.txs[0].txTime - 1, limit: block.txs.length })
                    const merkel = await this.computeMerkel(txs)
                    if (merkel != block.merkel) { //refetch all txs
                        const btx = await axios.get(url + "/api/queryTX?height=" + block.height)
                        if (btx.data) {
                            for (const ftx of btx.data) {
                                this.db.addFullTx({ txid: ftx.txid, rawtx: ftx.rawtx, time: ftx.txTime, oDataRecord: ftx.oDataRecord, chain: ftx.chain })
                            }
                        }
                    }
                    this.db.saveBlock(block)
                    this.uBlock = null
                }

            }
        } catch (e) {
            return false
        }
    }
    async run() {
        while (true) {
            const { Nodes } = this.indexers
            const bl = this.db.getLastBlock()
            this.height = bl ? bl.height + 1 : 0
            if (this.height < 5) { //
                if (!this.uBlock) { //wait the block to confirm
                    const block = await this.createBlock(this.height)
                    if (block) {
                        const sig = await Util.bitcoinSign(CONFIG.key, block.hash)
                        const uBlock = { sigs: {}, block }
                        uBlock.sigs[Nodes.thisNode.key] = sig
                        this.uBlock = uBlock
                        console.log("broadcast newBlock, height:", this.height, " hash:", this.uBlock.block.hash)
                        Nodes.notifyPeers({ cmd: "newBlock", data: uBlock })
                    }
                } else {
                    const { sigs, block } = this.uBlock
                    if (Object.keys(sigs).length > DEF.CONSENSUE_COUNT - 1) {
                        //save block
                        delete block.hash
                        block.sigs = sigs
                        block.hash = await Util.dataHash(stringify(block))
                        console.log("cBlock hash:", block.hash)
                        this.indexers.db.saveBlock(block)
                        this.uBlock = null
                    } else {
                        //broadcast my block
                        console.log("broadcast newBlock, height:", this.height, " hash:", this.uBlock.block.hash, " sig:", objLen(this.uBlock.sigs))
                        this.uBlock && Nodes.notifyPeers({ cmd: "newBlock", data: this.uBlock })

                        //check other node
                        console.log(JSON.stringify(this.nodePool))
                        for (const pkey in this.nodePool) {
                            const node = this.nodePool[pkey]
                            if (node.uBlock.block.height > this.height) { //download missing block
                                const n = this.db.getNode(pkey)
                                node && await this.downloadBlocks(this.height, node.uBlock.block.height - 1, n.url)
                            }
                        }
                    }

                }
            }
            await wait(DEF.BLOCK_TIME)
        }
    }
}
module.exports = BlockMgr