const { Server } = require('socket.io')
const axios = require('axios')
const CONFIG = require('./config').CONFIG

const cmd = {
    hello: {
        v: 1, rv: 1
    },
    getTx: {
        v: 1, rv: 1
    }
}
let wait = ms => new Promise(resolve => setTimeout(resolve, ms));
class NodeServer {
    start(indexers) {
        this.indexers = indexers
        const self = this
        const io = new Server()
        io.attach(CONFIG.server.socketPort || 31415)
        io.on("connection", (socket) => {
            console.log(socket.handshake.auth); //
            socket.on("hello", async (obj, ret) => {
                if (obj.v != cmd.hello.v) {
                    ret({ v: cmd.hello.rv, sig: null })
                    return
                }
                console.log("got hello data:", obj)
                if (obj.server) {
                    indexers.Nodes.addNode({ url: obj.server })
                }
                const sig = await indexers.Util.bitcoinSign(CONFIG.key, obj.data)
                ret({ v: cmd.hello.rv, sig })
            })
            self._setup(socket, indexers)
        });
        this.io = io
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
            ret(await db.pullNewTx(para.afterHeight))
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
        })
        socket.onAny((event, ...args) => {
            console.log(`server got ${event}`);
        });
    }
    notify(para) {
        if (!this.io) return false
        para.v = 1
        this.io.emit("notify", para)
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
    }
    setConnected(connected) {
        this.connected = connected
    }
    async connect(node) {
        const Util = this.indexers.Util
        this.node = node
        let socketUrl = null, url = node.id
        try {
            const res = await axios.get(url + "/api/nodeinfo")
            if (res.data && res.data.pkey) {
                const pUrl = URL.parse(url)
                socketUrl = "ws://" + pUrl.hostname + ":" + (res.data.socketPort || 31415)
                if (res.data.socketServer) {
                    socketUrl = "ws://" + res.data.socketServer + ":" + (res.data.socketPort || 31415)
                }
            }
        } catch (e) {
            return false
        }
        if (!socketUrl) return false
        const self = this
        return new Promise(resolve => {
            const manager = new Manager(socketUrl, { autoConnect: false });
            const socket = manager.socket("/");
            socket.auth = { username: "abc", key: "123", serverUrl: CONFIG.server.publicUrl }
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
                const s = CONFIG.server
                const serverUrl = s.publicUrl
                let helloPara = { data: datav, v: cmd.hello.v }
                if (s.publicUrl) helloPara.server = serverUrl
                socket.emit("hello", helloPara, (res) => {
                    console.log("reply from hello:", res)
                    if (!res.sig) {
                        resolve(false)
                        return
                    }
                    Util.bitcoinVerify(node.pkey, datav, res.sig).then(r => {
                        if (r) {
                            self.setConnected(true)
                            self.socket = socket
                            self._setup()
                            self.pullNewTxs.bind(self)()
                        } else {
                            console.log(socketUrl + " verification failed. Disconnect")
                            socket.disconnect()
                        }
                        resolve(r)
                    })
                })
            });
            socket.on('disconnect', function () {
                //self.indexers.Nodes.onNodeDisconnect(self.node)
                self.setConnected(false)
                console.log('Disconnected to:', socketUrl)
            })
            socket.onAny((event, ...args) => {
                //console.log(`got ${event}`);
            });
        })
    }
    async _setup() {
        const self = this
        this.socket.on('notify', (arg) => {
            //console.log('got notify:', arg)
            if (arg.cmd === "newtx") {
                const para = JSON.parse(arg.data)
                rpcHandler.handleNewTxNotify({ indexers: this.indexers, para, socket: self.socket })
            }
            if (arg.cmd === "newNode") {
                self.indexers.Nodes.addNode({ url: arg.data.url, isSuper: false })
            }
            if (arg.cmd === "newBlock") {
                self.indexers.blockMgr.onReceiveBlock(this.node.pkey, arg.data)
            }
        })
        this.socket.on('call', (arg1, arg2, cb) => {

        })
    }
    async getConfirmations(txids) {
        return new Promise(resolve => {
            const para = { txids }
            this.socket.emit("getConfirmations", para, (res) => {
                resolve(res)
            })
        })

    }
    async pullNewTxs(para = null) { //para = { from:12121233,to:-1}
        const { db, indexer } = this.indexers
        const height = +db.readConfig("txdb", "height")
        if (para == null) {
            para = { afterHeight: height }
        }
        para.v = 1
        this.socket.emit("pullNewTx", para, async (res) => {
            console.log("get reply from pullNewTx:")
            if (!res) return
            for (const tx of res) {
                await indexer.addTxFull({ txid: tx.txid, sigs: tx.sigs, rawtx: tx.rawtx, oDataRecord: tx.oDataRecord, time: tx.time, txTime: tx.txTime, chain: tx.chain })
            }
        })
    }
    async sendNewTx(obj) {
        return new Promise(resolve => {
            obj.v = 1
            this.socket.emit("sendNewTx", obj, (res) => {
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
        let { db, Parser, indexer, Nodes } = indexers
        if (para.sigs) {
            db.addTransactionSigs(para.txid, para.sigs)
        }
        if (this.handlingMap[para.txid]) {
            console.log("already handled")
            return
        }
        this.handlingMap[para.txid] = true

        if (!db.isTransactionParsed(para.txid, false) || force) {
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
            socket.emit("getTx", para, async (data) => {
                console.log("handleNewTx:", para.txid)
                if (!data) { delete this.handlingMap[para.txid]; return }

                if (await indexers.indexer.addTxFull({ txid: para.txid, rawtx: data.tx.rawtx || data.rawtx, txTime: data.tx.txTime, oDataRecord: data.oDataRecord, chain: data.tx.chain })) {
                    const sig = await Util.bitcoinSign(CONFIG.key, tx.txid)
                    db.addTransactionSigs(para.txid, { [Nodes.thisNode.key]: sig })
                    const sigs = db.getTransactionSigs(para.txid)
                    Nodes.notifyPeers({ cmd: "newtx", data: JSON.stringify({ txid: para.txid, sigs }) })
                }
                delete this.handlingMap[para.txid]
            })
        }
    }
    static async handleNewTxFromApp({ indexers, obj }) {
        const { indexer, Parser, Util, Nodes, db } = indexers
        let ret = await Parser.parseTX({ rawtx: obj.rawtx, oData: obj.oData, newTx: true, chain: obj.chain });
        if (ret.code != 0 || !ret.rtx.output || ret.rtx.output.err) {
            console.error("parseRaw error err:", ret)
            return { code: -1, message: ret.msg }
        }
        if (obj.more_rawtx) {
            for (const raw of obj.more_rawtx) { //if there are more 
                const rr = await Util.sendRawtx(raw, obj.chain);
                if (rr.code == 0) {
                    console.log("send more tx successfully. txid:", rr.txid);
                }
                else {
                    console.error("send more tx failed:", rr)
                    return rr
                }
            }
        }
        const ret1 = await Util.sendRawtx(obj.rawtx, obj.chain);
        if (ret1.code == 0) {
            console.log("send tx successfully. txid:", ret1.txid)
            let oDataRecord = null
            if (ret.rtx && ret.rtx.oHash) {
                oDataRecord = { raw: obj.oData, owner: ret.rtx.output.domain, time: ret.rtx.time }
            }
            const sig = await Util.bitcoinSign(CONFIG.key, ret1.txid)
            let sigs = { [Nodes.thisNode.key]: sig }
            if (await indexer.addTxFull({ txid: ret1.txid, sigs, rawtx: obj.rawtx, txTime: ret.rtx.ts, oDataRecord, noVerify: true, chain: obj.chain })) {
                db.addTransactionSigs(ret1.txid, sigs)
                sigs = db.getTransactionSigs(ret1.txid)
                Nodes.notifyPeers({ cmd: "newtx", data: JSON.stringify({ txid: ret1.txid, sigs }) })
            }
        } else {
            console.log("send tx failed")
        }
        return ret1
    }
}
module.exports = { NodeServer, NodeClient, rpcHandler }