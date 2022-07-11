const { DEF } = require('./def');
const { Util } = require('./util')
const CONFIG = require('./config').CONFIG
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
    async onReceiveBlock(nodeKey, uBlock) {
        const { Nodes } = this.indexers
        const { block, sigs } = uBlock
        if (sigs && block.height === this.height) {
            delete block.hash
            const hash = await Util.dataHash(JSON.stringify(block))
            block.hash = hash
            //check sig
            if (this.uBlock && this.uBlock.block.hash === hash) { //attach my sig
                const sigSender = sigs[nodeKey]
                if (await Util.bitcoinVerify(nodeKey, hash, sigSender)) { //check sender's sig
                    if (Object.keys(sigs).length > DEF.CONSENSUE_COUNT - 1) {
                        //save block
                    } else if (!sigs[Nodes.thisNode.key]) {
                        const sig = await Util.bitcoinSign(CONFIG.key, hash)
                        sigs[Nodes.thisNode.key] = sig
                        this.uBlock = uBlock
                        Nodes.notifyPeers({ cmd: "newBlock", data: this.uBlock })
                        if (Object.keys(sigs).length > DEF.CONSENSUE_COUNT - 1) {
                            //save block
                        }
                    }

                }
            }
        }
        if (!block.height) {
            //console.log("found")
        }
        // block && console.log("got new block:", block.height, block.hash, this.blockPool[block.hash]?.count, "from:", nodeKey)
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
                    console.log("broadcast newBlock, height:", this.height, " hash:", this.uBlock.block.hash)
                    this.uBlock && Nodes.notifyPeers({ cmd: "newBlock", data: this.uBlock })
                }
            }
            await wait(DEF.BLOCK_TIME)
        }
    }
}
module.exports = BlockMgr