const { Server } = require('socket.io')
const axios = require('axios')
const coinfly = require('coinfly')
const CONFIG = require('./config').CONFIG
let bsvlib = null
coinfly.create('bsv').then(res => bsvlib = res)
class NodeServer {
    start(indexers) {
        this.indexers = indexers
        const self = this
        const io = new Server()
        io.attach(CONFIG.server.socketPort || 31415)
        io.on("connection", (socket) => {
            console.log(socket.handshake.auth); //
            socket.on("hello", async (data, ret) => {
                console.log("got hello data:", data)
                const r = await bsvlib.sign(CONFIG.key, data)
                ret(r)
            })
            self._setup(socket, indexers)
        });
        this.io = io
    }
    async _setup(socket, indexers) {
        socket.on("getTx", async (txid, ret) => {
            console.log("getTx:", txid)
            const { db } = indexers
            const data = db.getFullTx({ txid })
            ret(data)
        })
        socket.on("queryTx", async (para, ret) => {
            console.log("queryTx:", para)
            const { resolver } = indexers
            const { from, to } = para
            ret(await resolver.readNBTX(from ? from : 0, to ? to : -1))
        })
        socket.on("sendNewTx", async (obj, ret) => {
            ret(await rpcHandler.handleNewTxFromApp({ indexers, obj }))
        })
        socket.onAny((event, ...args) => {
            console.log(`server got ${event}`);
        });
    }
    notify(para) {
        if (!this.io) return false
        this.io.emit("notify", para)
        return true
    }
    close() {
        this.io.close()
    }
}
const { Manager } = require('socket.io-client');
class NodeClient {
    constructor(indexers, domain) {
        this.indexers = indexers
        this.domain = domain
    }
    async connect(node) {
        let socketUrl = null, url = node.id
        try {
            const res = await axios.get(url + "/api/nodeinfo")
            if (res.data && res.data.pkey) {
                socketUrl = "ws://" + res.data.domain + ":" + (res.data.socketPort || 31415)
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
            socket.auth = { username: "abc", key: "123" }
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
                socket.emit("hello", datav, (res) => {
                    console.log("reply from hello:", res)
                    bsvlib.verify(node.pkey, datav, res).then(r => {
                        if (r) {
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
                console.log('Disconnected to:', socketUrl)
            })
            socket.onAny((event, ...args) => {
                console.log(`got ${event}`);
            });
        })
    }
    async _setup() {
        const self = this
        this.socket.on('notify', (arg) => {
            if (arg.cmd === "newtx") {
                const d = arg.data;
                const para = JSON.parse(d)
                rpcHandler.handleNewTxNotify({ indexers: this.indexers, para, socket: self.socket })
            }
        })
        this.socket.on('call', (arg1, arg2, cb) => {

        })
    }
    async pullNewTxs(para = null) { //para = { from:12121233,to:-1}
        const { db, indexer } = this.indexers
        if (para == null) {
            para = { from: db.getLatestTxTime() }
        }
        this.socket.emit("queryTx", para, async (res) => {
            console.log("get reply from queryTx:")
            for (const tx of res) {
                if (await indexer.addTxFull({ txid: tx.txid, rawtx: tx.rawtx, oDataRecord: tx.oDataRecord, time: tx.txTime ? tx.txTime : tx.time, chain: tx.chain })) {

                }
            }
        })
    }
    async sendNewTx(obj) {
        return new Promise(resolve => {
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
        if (this.handlingMap[para.txid]) {
            console.log("already handled")
            return
        }
        this.handlingMap[para.txid] = true

        if (!db.isTransactionParsed(para.txid, false) || force) {
            socket.emit("getTx", para.txid, async (data) => {
                console.log("handleNewTx:", para.txid)
                if (!data) { delete this.handlingMap[para.txid]; return }
                const item = data.oDataRecord
                const ret = await Parser.parse({ rawtx: data.tx.rawtx, oData: item?.raw, height: -1, chain: data.tx.chain });
                if (ret.code == 0 && ret.rtx?.oHash === item.hash)
                    await db.saveData({ data: item.raw, owner: item.owner, time: item.time, hash: item.hash, from: "api/handleNewTx" })
                else {
                    console.error("wrong rawtx format. ret:", ret)
                }
                if (await indexer.addTxFull({ txid: para.txid, rawtx: data.tx.rawtx, oDataRecord: data.oDataRecord, chain: data.tx.chain })) {
                    Nodes.notifyPeers({ cmd: "newtx", data: JSON.stringify({ txid: para.txid }) })
                }
            })
        }
        delete this.handlingMap[para.txid]
    }
    static async handleNewTxFromApp({ indexers, obj }) {
        const { indexer, Parser, Util, Nodes } = indexers
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
            if (await indexer.addTxFull({ txid: ret1.txid, rawtx: obj.rawtx, time: ret.rtx.time, oDataRecord, noVerify: true, chain: obj.chain }))
                Nodes.notifyPeers({ cmd: "newtx", data: JSON.stringify({ txid: ret1.txid, chain: obj.chain }) })
        } else {
            console.log("send tx failed")
        }
        return ret1
    }
}
module.exports = { NodeServer, NodeClient, rpcHandler }