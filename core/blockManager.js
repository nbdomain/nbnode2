const { DEF } = require('./def');
const { Util } = require('./util')
var stringify = require('json-stable-stringify');
const { default: axios } = require('axios');
let wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let objLen = obj => { return obj ? Object.keys(obj).length : 0 }
const REQUIRE_CONSENSUE = DEF.CONSENSUE_COUNT / 2
class BlockMgr {
    constructor(indexers) {
        this.indexers = indexers
        this.nodePool = {}
        this.blockPool = {}
        this.dmVerifyMap = {}
        this.height = 0
        this.signedBlock = -1
        this.uBlock = null //next unconfirmed block
        this.db = indexers.db
        this._canResolve = true
        this.removeTX = new Set()
        this.indexers.resolver.addController(this)
        //this.dmVerify = indexers.db.getDomainVerifyCode()
    }
    async createBlock(height, ntx = 10) {
        const db = this.db
        let preBlock = null, time = 0
        if (height > 0) {
            const b = db.getBlock(height - 1)
            if (b) {
                preBlock = b && JSON.parse(b.body)
                preBlock.hash = b.hash
            } else return null
        }
        if (preBlock) {
            const lastTx = preBlock.txs[preBlock.txs.length - 1]
            time = lastTx.txTime
            if (!this.lastBlockTime) this.lastBlockTime = time
            if (this.lastBlockTime < time) {
                this.lastBlockTime = time
                this.removeTX = new Set() // used to remove the txs that's already in previous Block
            }
            for (const tx of preBlock.txs) {
                if (tx.txTime == time) this.removeTX.add(tx.txid)
            }
        }
        const txs = db.getTransactions({ time, limit: DEF.MAX_BLOCK_LENGTH, remove: Array.from(this.removeTX) })
        if (!txs || txs.length == 0) {
            //return preBlock
            return null
        }
        const merkel = await this.computeMerkel(txs)
        const block = { version: DEF.BLOCK_VER, height: height, merkel, txs, preHash: preBlock ? preBlock.hash : null }
        //console.log(block)
        block.hash = await Util.dataHash(stringify(block))
        console.log("new block created. hash:", block.hash, " height:", block.height)
        return block
    }
    async computeMerkel(txs) {
        let lastHash = null
        for (const tx of txs) {
            const hash = await Util.dataHash(tx.txid + tx.bytes.toString("hex") + tx.txTime)
            lastHash = lastHash ? await Util.dataHash(hash + lastHash) : hash
            //console.log("txid:", tx.txid, " merkel:", lastHash)
            delete tx.bytes
        }
        return lastHash
    }
    verifyBlock(block) {
        const { Nodes, db } = this.indexers
        let preBlock = null
        if (block.height > 0) {
            const b = db.getBlock(block.height - 1)
            if (b) {
                preBlock = b && JSON.parse(b.body)
                preBlock.hash = b.hash
                return block.preHash = preBlock.hash
            }
        }
        return true
    }
    canResolve() {
        const ret = this._canResolve
        return ret
    }
    async onReceiveBlock(nodeKey, uBlock) {
        try {
            const { Nodes, db, config } = this.indexers
            const { block, sigs, dmVerify, dmSig } = uBlock
            if (Nodes.thisNode.key === nodeKey) return //myself
            if (block.version != DEF.BLOCK_VER) return
            //console.log("got block height:", block.height, " from:", nodeKey, "sigs:", sigs)
            if (!this.nodePool[nodeKey]) this.nodePool[nodeKey] = {}

            //console.log("receive:", nodeKey)
            if (dmVerify && dmSig) {
                if (!this.dmVerifyMap[dmVerify]) this.dmVerifyMap[dmVerify] = {}
                let hasNewVal = false
                if (this.dmVerifyMap[dmVerify][nodeKey] != dmSig) {
                    if (await Util.bitcoinVerify(nodeKey, dmVerify, dmSig)) {
                        this.dmVerifyMap[dmVerify][nodeKey] = dmSig
                        hasNewVal = true
                    }

                }
                let maxVerify = null, maxLen = 0, maxNodeKey = null
                for (const verify in this.dmVerifyMap) { //find the most aggreed verify
                    if (hasNewVal && dmVerify !== verify) delete this.dmVerifyMap[verify][nodeKey]
                    if (objLen(this.dmVerifyMap[verify]) > maxLen) {
                        maxVerify = verify, maxLen = objLen(this.dmVerifyMap[verify])
                        maxNodeKey = Object.keys(this.dmVerifyMap[verify])[0]
                    }
                }
                if (maxVerify === this.dmVerify) {
                    maxLen++ //add my vote
                }
                if ((maxLen >= REQUIRE_CONSENSUE || !Nodes.isProducer()) && this.lastVerify != maxVerify && this.canResolve()) {//reach consense

                    if (maxVerify === this.dmVerify) { //I win, backup the good domain db
                        this.lastVerify = maxVerify
                        await db.backupDB()
                        this.dmVerifyMap = {}
                    } else { //I lost, restore last good domain db
                        if (!this.waitSyncStart || this.waitSyncStart === 0) this.waitSyncStart = Date.now()
                        const span = (Date.now() - this.waitSyncStart) / 1000

                        if (this.height < 100 || span < 120) {
                            console.error("found inconsistent domain db, waited:", span, " seconds")
                        } else {
                            this.waitSyncStart = 0
                            this.lastVerify = maxVerify
                            this.dmVerifyMap = {}
                            const node = this.db.getNode(maxNodeKey)
                            if (await Nodes.downloadAndUseDomainDB(node.url, this.txConsensue == false) == false) {
                                console.error("failed to download good db")
                                db.restoreLastGoodDomainDB()
                            }
                        }

                    }
                } else {
                    this.waitSyncCount = 0
                }
            }
            if (!this.uBlock) {
                this.nodePool[nodeKey].uBlock = uBlock
                return
            }
            let poolNode = this.nodePool[nodeKey]
            if (sigs && block.height === this.height && (JSON.stringify(sigs) !== JSON.stringify(poolNode.sigs))) {
                poolNode = this.nodePool[nodeKey]
                poolNode.sigs = sigs
                delete block.hash
                const hash = await Util.dataHash(stringify(block))
                block.hash = poolNode.hash = hash
                //check sender's sig
                const sigSender = sigs[nodeKey]
                if (await Util.bitcoinVerify(nodeKey, hash, sigSender) == false) return
                if (this.uBlock && this.uBlock.block.hash === hash) { //same as my block

                    if (!sigs[Nodes.thisNode.key]) { //add my sig
                        const sig = await Util.bitcoinSign(config.key, hash)
                        sigs[Nodes.thisNode.key] = sig
                    }
                    if (objLen(this.uBlock.sigs) < objLen(sigs)) {
                        this.uBlock = uBlock
                    }
                }
            }

            this.nodePool[nodeKey].uBlock = uBlock
            // block && console.log("got new block:", block.height, block.hash, this.blockPool[block.hash]?.count, "from:", nodeKey)
        } catch (e) {
            console.error(e)
        }
    }
    async downloadBlocks(from, to, url) {
        let ret = false, resetDB = false
        const { db, indexer, Nodes } = this.indexers
        this._canResolve = false
        try {
            console.log(`downloading block ${from}-${to} from: ${url}`)
            const res = await axios.get(url + `/api/getBlocks?from=${from}&&to=${to}`)
            if (res.data) {
                db.restoreLastGoodDomainDB() //restore last good state
                for (const blockItem of res.data) {
                    let block = JSON.parse(blockItem.body)
                    //if (block.version != DEF.BLOCK_VER) continue
                    const sigs = JSON.parse(blockItem.sigs)
                    block.hash = blockItem.hash
                    //if (objLen(block.sigs) < DEF.CONSENSUE_COUNT) return false
                    let tempBlock = await this.createBlock(block.height)
                    const merkel = tempBlock ? tempBlock.merkel : null
                    if (merkel != block.merkel) { //refetch all txs in the block
                        const btx = await axios.get(url + "/api/queryTX?height=" + block.height)
                        if (btx.data) {
                            tempBlock && this.db.deleteTxs(tempBlock.txs)
                            for (const ftx of btx.data) {
                                await indexer.addTxFull({ txid: ftx.txid, sigs: ftx.sigs, rawtx: ftx.rawtx, txTime: ftx.txTime, oDataRecord: ftx.oDataRecord, chain: ftx.chain, replace: true })
                                const txItem = block.txs.find(item => item.txid === ftx.txid)
                                if (txItem) txItem.done = true
                            }
                            for (const txItem of block.txs) {
                                if (!txItem.done) { //found missed tx
                                    console.log("Found missed tx:", txItem.txid)
                                    const data = await Nodes.getTx(txItem.txid)
                                    if (data) {
                                        await indexer.addTxFull({ txid: txid, sigs: data.tx.sigs, rawtx: data.tx.rawtx, txTime: data.tx.txTime, oDataRecord: data.oDataRecord, chain: data.tx.chain, replace: true })
                                    } else {
                                        console.error("Missed tx can't be fetched. txid:", txItem.txid)
                                    }
                                }
                            }
                        }
                    }
                    if (!this.verifyBlock(block)) {
                        ret = false
                        break;
                    }
                    await this.db.saveBlock({ sigs, block })
                    ret = true
                }
            }
        } catch (e) {
            console.error(e.message)
            return false
        } finally {
            this._canResolve = true
        }
        return ret
    }
    async onNewTx() {
        this.hasNewTX = true
        this.uBlock = null
    }
    /*    async syncDomainDB() {
            const { db, Nodes } = this.indexers
            if (Nodes.isProducer()) return
            console.log("Syncing domain db ...")
            if(Nodes.getConnectedClients()=={})return
            const url = Nodes.getConnectedClients()[0].node.id
            if (await Nodes.downloadAndUseDomainDB(url) == false) {
                console.error("failed to download good db")
            }
        }
        async isInSync(){
            const { db, Nodes } = this.indexers
            if (Nodes.isProducer()) return
            if(Nodes.getConnectedClients()=={})return
            const url = Nodes.getConnectedClients()[0].node.id
            try{
                const res = await axios.get(url + "/api/datacount")
                if (res.data && res.data.dmHash) {
                    const verify = db.getDomainVerifyCode()
                    if (verify === res.data.dmHash) {
                        console.log("In sync with:", url)
                        return true
                    }
                }
            }catch(e){}
            
            return false
        }*/
    async run() {
        while (true) {
            const { Nodes, db, config } = this.indexers
            if (this.hasNewTX) {
                this.hasNewTX = false
                await wait(DEF.BLOCK_TIME)
                continue
            }
            const bl = this.db.getLastBlock()
            console.log("got last block", bl?.height)
            this.height = bl ? bl.height + 1 : 0
            if (Nodes.isProducer()) { //create and broadcast blocks
                if (!this.uBlock) { //wait the block to confirm
                    let block = await this.createBlock(this.height)
                    if (block) {
                        this.height = block.height
                        if (block.txs.length < 100) { //less than 100, wait for a while, give time for new tx to broadcast
                            await wait(DEF.BLOCK_TIME * 2)
                            block = await this.createBlock(this.height)
                        }
                        if (block) {
                            const sig = await Util.bitcoinSign(config.key, block.hash)
                            const uBlock = { sigs: {}, block }
                            uBlock.sigs[Nodes.thisNode.key] = sig
                            this.uBlock = uBlock
                        }
                    }

                } else {
                    const { sigs, block } = this.uBlock
                    if (Object.keys(sigs).length >= Math.floor(REQUIRE_CONSENSUE + 1)) {
                        //save block
                        console.log("cBlock hash:", block.hash)
                        await this.indexers.db.saveBlock({ sigs, block })
                        this.uBlock = null
                        this.hasNewTX = false
                        continue
                    }
                }
                //broadcast current block or last block
                let bcBlock = this.uBlock
                if (!bcBlock) {
                    bcBlock = this.db.getBlock(this.height - 1, true)
                    if (bcBlock) bcBlock.confirmed = true
                }
                if (bcBlock) {
                    const dmVerify = db.getDomainVerifyCode()
                    if (this.dmVerify != dmVerify) { //update my domain sig
                        this.dmSig = await Util.bitcoinSign(config.key, dmVerify)
                        this.dmVerify = dmVerify
                    }
                    bcBlock.dmSig = this.dmSig
                    bcBlock.dmVerify = dmVerify
                    if (objLen(bcBlock.sigs) > REQUIRE_CONSENSUE) this.txConsensue = true
                    if (objLen(this.dmVerifyMap[this.dmVerify]) > REQUIRE_CONSENSUE) this.dmConsensue = true
                    console.log("broadcast block, height:", bcBlock.block.height, " hash:", bcBlock.block.hash, " signed by:", objLen(bcBlock.sigs), " dmVerify:", dmVerify, "singed by:", objLen(this.dmVerifyMap[this.dmVerify]))
                    Nodes.notifyPeers({ cmd: "newBlock", data: bcBlock })
                }
            } else {
                this.dmVerify = db.getDomainVerifyCode()
                console.log("dmVerify:", this.dmVerify)
            }
            //check other node
            //console.log(JSON.stringify(this.nodePool))
            let startHeight = this.height
            for (const pkey in this.nodePool) {
                const node = this.nodePool[pkey]
                if (!node.uBlock) continue
                const height = node.uBlock.confirmed ? node.uBlock.block.height : node.uBlock.block.height - 1
                if (height >= startHeight) { //download missing block
                    const n = Nodes.nodeFromKey(pkey)
                    const endHight = node.uBlock.block.height - startHeight > 500 ? startHeight + 500 : node.uBlock.block.height
                    if (endHight - startHeight >= 200) continue
                    if (await this.downloadBlocks(startHeight, endHight, n.id)) {
                        this.uBlock = null
                        this.hasNewTX = false
                        break;
                    } else {
                        startHeight -= 10 //rewind 10 blocks
                        if (startHeight < 0) startHeight = 0
                    }
                }
            }
            await wait(DEF.BLOCK_TIME)
        }
        return true
    }
}
module.exports = BlockMgr