const { Server } = require('socket.io')
const axios = require('axios')
const NBPeer = require('./nbpeer')

const cmd = {
    hello: {
        v: 1, rv: 1
    },
    getTx: {
        v: 1, rv: 1
    }
}
let g_inAddTx = false
let wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let objLen = obj => { return obj ? Object.keys(obj).length : 0 }
class NodeServer {
    start(indexers) {
        this.indexers = indexers
        const { config } = this.indexers
        this.nbpeer = new NBPeer()
        const self = this
        const io = new Server(indexers.server.listener, {
            cors: {
                "origin": "*",
                "methods": "GET,HEAD,PUT,PATCH,POST,DELETE",
                "preflightContinue": false,
                "optionsSuccessStatus": 204
            },
            transports: ["websocket"]
        })
        /*io.attach(CONFIG.server.socketPort || 31415, {
            cors: {
                "origin": "*",
                "methods": "GET,HEAD,PUT,PATCH,POST,DELETE",
                "preflightContinue": false,
                "optionsSuccessStatus": 204
            }
        })*/
        io.on("connection", (socket) => {
            console.log("socket id:", socket.id, socket.handshake.auth); //
            if (socket.handshake.auth.chainid != config.chainid) {
                console.error("different chainid, disconnect")
                socket.disconnect()
                return
            }
            if (io.of('/').sockets.size > 20) {
                console.error("enough clients, disconnect")
                socket.disconnect()
                return
            }
            socket.on("hello", async (obj, ret) => {
                if (obj.v != cmd.hello.v) {
                    ret({ v: cmd.hello.rv, sig: null })
                    return
                }
                console.log("got hello data:", obj)
                if (obj.server) {
                    console.log("adding:", obj.server)
                    await indexers.Nodes.addNode({ url: obj.server })
                }
                const sig = await indexers.Util.bitcoinSign(config.key, obj.data)
                ret({ v: cmd.hello.rv, sig })
            })
            self._setup(socket, indexers)
        });
        this.io = io
        const nbp = io.of("/nbpeer")
        nbp.on("connection", socket => {
            console.log("someone connected socketid:", socket.id);
            const info = socket.handshake.auth.info
            if (!info || !info.id) {
                socket.disconnect()
                return
            }
            const peerid = this.nbpeer.addPeer(info.id, socket)

            socket.onAny((event, des_id, from_id, args, ret) => {
                this.nbpeer.relayEmit(des_id, from_id, event, args, ret)
            })
            socket.on("disconnect", (reason) => {
                console.error("server disconnected:", reason, " id:", socket.id)
                socket.removeAllListeners()
                this.nbpeer.removePeerBySocket(socket.id)
            })
        });
    }
    async _setup(socket, indexers) {
        socket.on("getTx", async (para, ret) => {
            console.log("getTx:", para)
            const { db } = indexers
            const data = db.getFullTx({ txid: para.txid })
            ret(data)
        })
        socket.on("queryTx", async (para, ret) => {
            console.log("queryTx:", para)
            const { resolver } = indexers
            const { from, to } = para
            ret(await resolver.readNBTX(from ? from : 0, to ? to : -1))
        })
        socket.on("pullNewTx", async (para, ret) => {
            console.log("pullNewTx:", para)
            const { db } = indexers
            ret(await db.pullNewTx(para))
        })
        socket.on("getConfirmations", (para, ret) => {
            console.log("getConfirmations:", para)
            const { db } = indexers
            ret(db.getConfirmations(para.txids))
        })

        socket.on("sendNewTx", async (obj, ret) => {
            ret(await rpcHandler.handleNewTxFromApp({ indexers, obj }))
        })
        socket.on("disconnect", (reason) => {
            console.error("server disconnected:", reason, " :", socket.handshake.auth.serverUrl)
            socket.removeAllListeners()
        })
        socket.onAny((event, ...args) => {
            console.log(`server got ${event}`);
        });
    }
    notify(para) {
        if (!this.io) return false
        if (!para.id)
            para.id = Date.now().toString(36)
        this.io.of('/').volatile.emit("notify", para)
        return true
    }
    close() {
        this.io.close()
    }
}
const { Manager } = require('socket.io-client');
const { Util } = require('./util')
const URL = require('url')
class NodeClient {
    constructor(indexers, domain) {
        this.indexers = indexers
        this.from = domain
        this.connected = false
        this.handlingMap = {}
    }
    setConnected(connected) {
        this.connected = connected
    }
    async connect(node) {
        const { config } = this.indexers

        const Util = this.indexers.Util
        this.node = node
        let socketUrl = null, url = node.id
        /*const pUrl = URL.parse(url)
        socketUrl = "ws://" + pUrl.hostname + ":" + (node.info.socketPort || 31415)
        if (node.info.socketServer) {
            socketUrl = "ws://" + node.info.socketServer + ":" + (node.info.socketPort || 31415)
        }*/
        socketUrl = url
        console.log("connecting to", url)
        if (!socketUrl) return false
        const self = this
        return new Promise(resolve => {
            const manager = new Manager(socketUrl, { autoConnect: false, transports: ["websocket"] });
            const socket = manager.socket("/");
            socket.auth = { username: "abc", key: "123", serverUrl: config.server.publicUrl, chainid: config.chainid }
            manager.open((err) => {
                if (err) {
                    console.error(err)
                    resolve(false)
                } else {
                    console.log("manager connected")
                }
            });
            socket.connect()
            socket.on('connect', function () {
                console.log('Connected to:', socketUrl);
                const datav = Date.now().toString()
                const s = config.server
                const serverUrl = s.publicUrl
                let helloPara = { data: datav, v: cmd.hello.v }
                if (s.publicUrl) helloPara.server = serverUrl
                if (s.hideFromList) helloPara.hide = true
                socket.emit("hello", helloPara, (res) => {
                    console.log("reply from hello:", res)
                    if (!res.sig) {
                        socket.disconnect()
                        resolve(false)
                        return
                    }
                    console.log("connected to:", node.pkey)
                    Util.bitcoinVerify(node.pkey, datav, res.sig).then(async r => {
                        if (r) {
                            self.setConnected(true)
                            // await self.syncDomainDB.bind(self)()
                            //await self.pullNewTxs.bind(self)()
                        } else {
                            console.log(socketUrl + " verification failed. Disconnect")
                            socket.disconnect()
                        }
                        resolve(r)
                    })
                })
            });
            this.socket = socket
            this._setup()
            socket.on('disconnect', function () {
                //self.indexers.Nodes.onNodeDisconnect(self.node)
                self.setConnected(false)
                console.log('Disconnected to:', socketUrl)
            })
        })
    }
    async handleNewTx() {
        if (this.newTxStarted) return
        this.newTxStarted = true
        while (true) {
            const arg = this.newtxQ.shift()
            if (arg) {
                const para = JSON.parse(arg.data)
                await rpcHandler.handleNewTxNotify({ indexers: this.indexers, para, socket: this.socket })
            } else {
                await wait(1000)
            }
        }
    }
    async _setup() {
        const { logger } = this.indexers
        const self = this
        console.log("setup for:", this.node.id)
        this.socket.on('notify', async (arg) => {
            if (arg.id && self.handlingMap[arg.id])
                return
            logger.logFile("handling:", arg.id)
            if (objLen(self.handlingMap) > 1000) self.handlingMap = {}
            self.handlingMap[arg.id] = true
            if (arg.cmd === "newtx") {
                if (!self.newtxQ) self.newtxQ = []
                self.newtxQ.push(arg)
                self.handleNewTx()
                //const para = JSON.parse(arg.data)
                //await rpcHandler.handleNewTxNotify({ indexers: this.indexers, para, socket: self.socket })
            }
            if (arg.cmd === "newNode") {
                await self.indexers.Nodes.addNode({ url: arg.data.url })
            }
            if (arg.cmd === "newBlock") {
                await self.indexers.blockMgr.onReceiveBlock(this.node.pkey, arg.data)
            }
            if (arg.cmd === "publish") {
                self.indexers.pubsub.publish(arg.data.topic, arg.data.msg, arg.id)
            }
            if (arg.cmd === "update") {
                self.indexers.pubsub.publish(arg.data.topic, arg.data.msg, arg.id)
            }
        })
    }
    async getConfirmations(txids) {
        return new Promise(resolve => {
            const para = { txids }
            this.socket.volatile.emit("getConfirmations", para, (res) => {
                resolve(res)
            })
        })

    }

    async pullNewTxs(para = null) { //para = { from:12121233,to:-1}
        const { db, indexer } = this.indexers
        //const height = +db.readConfig("txdb", "height")
        const fromTime = db.readConfig('dmdb', 'maxResolvedTxTime')
        if (para == null) {
            para = { fromTime }
        }
        para.v = 1
        para.from = this.from
        const self = this
        this.socket.volatile.emit("pullNewTx", para, async (res) => {
            console.log("get reply from pullNewTx:", this.node.id)
            if (!res) return
            for (const tx of res) {
                if (g_inAddTx) {
                    console.error("pullNewtx re-entry, continue")
                    continue
                }
                g_inAddTx = true
                await indexer.addTxFull({ txid: tx.txid, sigs: tx.sigs, rawtx: tx.rawtx, oDataRecord: tx.oDataRecord, time: tx.time, txTime: tx.txTime, chain: tx.chain })
                g_inAddTx = false
            }
        })
    }
    async sendNewTx(obj) {
        console.log("sending to:", this.node)
        return new Promise(resolve => {
            obj.v = 1
            this.socket.volatile.emit("sendNewTx", obj, (res) => {
                resolve(res)
            })
        })

    }
    close() {
        this.socket.close()
    }
}
class rpcHandler {
    static handlingMap = {}
    static async handleNewTxNotify({ indexers, para, socket, force = false }) {
        let { db, Parser, indexer, Nodes, config, resolver } = indexers
        if (para.sigs) {
            db.addTransactionSigs(para.txid, para.sigs)
        }
        if (this.handlingMap[para.txid]) {
            console.log("already handled")
            return
        }
        this.handlingMap[para.txid] = true
        let mySig = null
        if (!db.hasTransaction(para.txid) || force) {
            para.v = 1
            const tx = para
            if (Nodes.isProducer()) { //verify tx
                for (let i = 0; i < 5; i++) {
                    const ret = await Util.verifyTX([tx]) //return invalid tx array
                    if (ret.length > 0) {
                        console.error("tx not found in mempool:", tx.txid)
                        if (i >= 4) {
                            console.error("tx will be rejected:", tx.txid)
                            return
                        }
                    } else {
                        console.log("tx verified:", tx.txid)
                        break;
                    }
                    await wait(2000)
                }
            }
            const data = await Nodes.getTx(para.txid)
            if (!data) { console.error("data is missing:", para.txid); delete this.handlingMap[para.txid]; return }
            mySig = await Util.bitcoinSign(config.key, tx.txid)
            if (await indexers.indexer.addTxFull({ txid: para.txid, sigs: { ...para.sigs, [Nodes.thisNode.key]: mySig }, rawtx: data.tx.rawtx || data.rawtx, txTime: data.tx.txTime, oDataRecord: data.oDataRecord, chain: data.tx.chain })) {
                const sigs = db.getTransactionSigs(para.txid)
                Nodes.notifyPeers({ cmd: "newtx", data: JSON.stringify({ txid: para.txid, sigs }) })
                resolver.resolveOneTX(db.getTransaction(tx.txid))
            } else {
                console.error("error adding:", para.txid)
            }
            delete this.handlingMap[para.txid]
            /*socket.emit("getTx", para, async (data) => {
                console.log("handleNewTx:", para.txid)
                if (!data) { console.error("data is missing:", para.txid); delete this.handlingMap[para.txid]; return }
                mySig = await Util.bitcoinSign(config.key, tx.txid)
                if (await indexers.indexer.addTxFull({ txid: para.txid, sigs: { ...para.sigs, [Nodes.thisNode.key]: mySig }, rawtx: data.tx.rawtx || data.rawtx, txTime: data.tx.txTime, oDataRecord: data.oDataRecord, chain: data.tx.chain })) {
                    const sigs = db.getTransactionSigs(para.txid)
                    Nodes.notifyPeers({ cmd: "newtx", data: JSON.stringify({ txid: para.txid, sigs }) })
                    resolver.resolveOneTX(db.getTransaction(tx.txid))
                } else {
                    console.error("error adding:", para.txid)
                }
                delete this.handlingMap[para.txid]
            }) */
        }
    }
    static async handleNewTxFromApp({ indexers, obj }) {
        const { indexer, Parser, Util, Nodes, db, config, resolver } = indexers
        let ret = await Parser.parseTX({ rawtx: obj.rawtx, oData: obj.oData, newTx: true, chain: obj.chain });
        if (ret.code != 0 || !ret.rtx.output || ret.rtx.output.err) {
            console.error("parseRaw error err:", ret)
            return { code: -1, message: ret.msg }
        }
        let txids = null, cost = 0
        if (obj.more_rawtx) {
            txids = []
            for (const raw of obj.more_rawtx) { //if there are more 
                const rr = await Util.sendRawtx(raw, obj.chain);
                if (rr.code == 0) {
                    console.log("send more tx successfully. txid:", rr.txid);
                    txids.push(rr.txid)
                    cost += rr.cost
                }
                else {
                    console.error("send more tx failed:", rr)
                    return rr
                }
            }
        }
        const ret1 = await Util.sendRawtx(obj.rawtx, obj.chain);
        if (ret1.code == 0) {
            cost += ret1.cost
            if (txids) ret1.more_txid = txids
            console.log("send tx successfully. txid:", ret1.txid)
            let oDataRecord = null
            if (ret.rtx && ret.rtx.oHash) {
                oDataRecord = { raw: obj.oData, owner: ret.rtx.output.domain, time: ret.rtx.time }
            }
            const sig = await Util.bitcoinSign(config.key, ret1.txid)
            let sigs = { [Nodes.thisNode.key]: sig }
            if (await indexer.addTxFull({ txid: ret1.txid, sigs, rawtx: obj.rawtx, txTime: ret.rtx.ts, oDataRecord, noVerify: true, chain: obj.chain })) {
                db.addTransactionSigs(ret1.txid, sigs)
                sigs = db.getTransactionSigs(ret1.txid)
                Nodes.notifyPeers({ cmd: "newtx", data: JSON.stringify({ txid: ret1.txid, sigs }) })
                const list = db.getUnresolvedTX(1)
                if (list && list.length > 0) {
                    resolver.resolveOneTX(list[0])
                }
            }
        } else {
            console.log("send tx failed")
        }
        return ret1
    }
}
module.exports = { NodeServer, NodeClient, rpcHandler }