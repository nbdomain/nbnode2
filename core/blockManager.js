const { DEF } = require('./def');
const { Util } = require('./util')
let wait = ms => new Promise(resolve => setTimeout(resolve, ms));
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
        block.hash = await Util.dataHash(JSON.stringify(block))
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
    async onReceiveBlock(unconfirmedBlock) {
        const { block, nodeKey } = unconfirmedBlock
        if (block.height === this.height && !this.nodePool[nodeKey]) {
            this.nodePool[nodeKey] = true
            delete block.hash
            const hash = await Util.dataHash(JSON.stringify(block))
            this.nodePool[nodeKey] = hash
            block.hash = hash
            if (!this.blockPool[hash]) {
                this.blockPool[hash] = {}
                this.blockPool[hash].block = block
                this.blockPool[hash].count = 1
            } else {
                this.blockPool[hash].count++
                if (this.blockPool[hash].count >= DEF.CONSENSUE_COUNT - 1) { //winning block
                    const nodes = this.indexers.Nodes
                    for (const key in this.nodePool) {
                        this.nodePool[key] === hash ? nodes.incCorrect(key) : nodes.incMistake(key)
                    }
                    this.db.saveBlock(this.blockPool[block.hash].block)
                    this.uBlock = null
                    this.blockPool = {} //clear blockPool
                    this.nodePool = {}
                }
            }
        }
        if (!block.height) {
            console.log("found")
        }
        block && console.log("got new block:", block.height, block.hash, this.blockPool[block.hash]?.count, "from:", nodeKey)
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
                        const unconfirmedBlock = { nodeKey: Nodes.thisNode.key, block }
                        this.uBlock = unconfirmedBlock
                        await this.onReceiveBlock(unconfirmedBlock)
                        Nodes.notifyPeers({ cmd: "newBlock", data: unconfirmedBlock })
                    }
                } else {
                    this.uBlock && Nodes.notifyPeers({ cmd: "newBlock", data: this.uBlock })
                }
            }
            await wait(DEF.BLOCK_TIME)
        }
    }
}
module.exports = BlockMgr