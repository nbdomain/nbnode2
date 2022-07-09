const { DEF } = require('./def');
const { Util } = require('./util')
let wait = ms => new Promise(resolve => setTimeout(resolve, ms));
class BlockMgr {
    constructor(indexers) {
        this.indexers = indexers
        this.nodePool = {}
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
        const block = { version: DEF.BLOCK_VER, height: height, merkel, txs, preBlockHash: lastBlock ? lastBlock.markel : null }
        block.hash = await Util.dataHash(JSON.stringify(block))
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
    async onReceiveBlock(unconfirmedBlock) {
        const { block, nodeKey } = unconfirmedBlock
        if (block.height === this.height && !this.nodePool[nodeKey]) {
            delete block.hash
            this.nodePool[nodeKey] = true
            const toHash = JSON.stringify(block)
            //console.log("toHash:", toHash, toHash.length)
            const hash = await Util.dataHash(toHash)
            block.hash = hash
            if (!this.blockPool[hash]) {
                this.blockPool[hash] = {}
                this.blockPool[hash].block = block
                this.blockPool[hash].count = 1
            } else {
                this.blockPool[hash].count++
                if (this.blockPool[hash].count > 1) {
                    //this.db.saveBlock(this.blockPool[block.hash])
                    //this.blockPool = {} //clear blockPool
                }
            }
        }
        if (!this.blockPool[block.hash]) {
            console.log("found")
        }
        block && console.log("got new block:", block.height, block.hash, this.blockPool[block.hash]?.count)
    }
    async run() {
        const { Nodes } = this.indexers
        if (Object.keys(this.blockPool).length == 0) { //wait the block to confirm
            const bl = this.db.getLastBlock()
            this.height = bl ? bl.height : 0
            const block = await this.createBlock(this.height)
            if (block) {
                const unconfirmedBlock = { nodeKey: Nodes.thisNode.key, block }
                this.unconfirmedBlock = unconfirmedBlock
                await this.onReceiveBlock(unconfirmedBlock)
                Nodes.notifyPeers({ cmd: "newBlock", data: unconfirmedBlock })
            }

        } else {
            this.unconfirmedBlock && Nodes.notifyPeers({ cmd: "newBlock", data: this.unconfirmedBlock })
        }
        await wait(DEF.BLOCK_TIME)
        this.run()
    }
}
module.exports = BlockMgr