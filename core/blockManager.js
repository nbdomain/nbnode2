const { readUser } = require('nblib2')
const { DEF } = require('./def');
const { db } = require('./parser');
const { Util } = require('./util')
let wait = ms => new Promise(resolve => setTimeout(resolve, ms));
class BlockMgr {
    constructor(indexers) {
        this.indexers = indexers
        this.blockPool = {}
        this.height = -1
        this.db = indexers.db
    }
    async createBlock(height) {
        const db = this.db
        let lastBlock = null, time = 0
        if (height > 0) {
            lastBlock = db.getBlock(height - 1)
        }
        if (lastBlock) {
            const bl = lastBlock.txs[lastBlock.txs.length - 1]
            time = db.getTransactionTime(bl.txid)
        }
        const txs = db.getTransactions({ time, limit: DEF.MAX_BLOCK_LENGTH })
        if (!txs || txs.length == 0) return null
        const merkel = await this.computeMerkel(txs)
        const block = { version: DEF.BLOCK_VER, height: height, txs, merkel, preBlockHash: lastBlock ? lastBlock.markel : null }
        return block
    }
    async computeMerkel(txs) {
        let lastHash = null
        for (const tx of txs) {
            const hash = await Util.dataHash(tx.txid + tx.bytes.toString("hex") + tx.txTime)
            lastHash = lastHash ? await Util.dataHash(hash + lastHash) : hash
        }
        return lastHash
    }
    async onReceiveBlock(block) {
        delete block.hash
        block.hash = await Util.dataHash(JSON.stringify(block))
        if (!this.blockPool[block.hash]) {
            this.blockPool[block.hash] = block
            this.blockPool[block.hash].count = 1
        } else {
            this.blockPool[block.hash].count++
            if (this.blockPool[block.hash].count > 1) {
                //this.db.saveBlock(this.blockPool[block.hash])
                //this.blockPool = {} //clear blockPool
            }
        }
        console.log("got new block:", block.height, block.merkel, this.blockPool[block.hash].count)
    }
    async run() {
        const { Nodes } = this.indexers
        if (Object.keys(this.blockPool).length == 0) { //wait the block to confirm
            const bl = this.db.getLastBlock()
            this.height = bl ? bl.height : 0
            const block = await this.createBlock(this.height)
            block && (this.curBlock = block)
            block && await this.onReceiveBlock(block)
            block && Nodes.notifyPeers({ cmd: "newBlock", data: block })
        } else {
            this.curBlock && Nodes.notifyPeers({ cmd: "newBlock", data: this.curBlock })
        }
        await wait(DEF.BLOCK_TIME)
        this.run()
    }
}
module.exports = BlockMgr