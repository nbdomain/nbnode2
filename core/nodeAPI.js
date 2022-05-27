const { Server } = require('socket.io')
const axios = require('axios')
const coinfly = require('coinfly')
const CONFIG = require('./config').CONFIG
let bsvlib = null
coinfly.create('bsv').then(res => bsvlib = res)
class NodeServer {
    start(httpServer) {
        const io = new Server()
        io.attach(CONFIG.server.socketPort || 31415)
        io.on("connection", (socket) => {
            console.log(socket.handshake.auth); //
            socket.on("hello", async (data, ret) => {
                console.log("got hello data:", data)
                const r = await bsvlib.sign(CONFIG.key, data)
                ret(r)
            })
        });
        this.io = io
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
    constructor(indexers) {
        this.indexers = indexers
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
                        } else {
                            console.log(socketUrl + " verification failed. Disconnect")
                            socket.disconnect()
                        }
                        resolve(r)
                    })
                })
            });
        })
    }
    async _setup() {
        this.socket.on('notify', (arg) => {
            if (arg.cmd === "newtx") {
                const d = para.data;
                const para = JSON.parse(d)
                const from = req.query['from']
                rpcHandler.handleNewTx({ indexers: this.indexers, para, from })
            }
        })
        this.socket.on('call', (arg1, arg2, cb) => {

        })
    }

    close() {

    }
}
class rpcHandler {
    static async handleNewTx({ indexers, para, from, force = false }) {
        let { db, Nodes, Parser, indexer } = indexers
        const chain = para.chain ? para.chain : 'bsv'
        if (!db.isTransactionParsed(para.txid, false) || force) {
            const data = await Nodes.getTx(para.txid, from)
            if (data) {
                console.log("handleNewTx:", para.txid)
                const item = data.oDataRecord
                const ret = await (Parser.parse({ rawtx: data.tx.rawtx, oData: item?.raw, height: -1, chain: data.tx.chain }));
                if (ret.code == 0 && ret.rtx?.oHash === item.hash)
                    await db.saveData({ data: item.raw, owner: item.owner, time: item.time, hash: item.hash, from: "api/handleNewTx" })
                else {
                    console.error("wrong rawtx format. ret:", ret)
                }
                await indexer.addTxFull({ txid: para.txid, rawtx: data.rawtx, oDataRecord: data.oDataRecord, chain })
            }
        }
    }
}
module.exports = { NodeServer, NodeClient, rpcHandler }