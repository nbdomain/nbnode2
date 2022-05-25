const { Server } = require('socket.io')
const axios = require('axios')
const coinfly = require('coinfly')
const CONFIG = require('./config').CONFIG
let bsvlib = null
coinfly.create('bsv').then(res => bsvlib = res)
class NodeServer {
    start(httpServer) {
        const io = new Server()
        io.attach(httpServer)
        io.on("connection", (socket) => {
            console.log(socket.handshake.auth); //
            socket.on("hello", async (data, ret) => {
                console.log("got hello data:", data)
                const r = await bsvlib.sign(CONFIG.key, data)
                ret(r)
            })
        });
    }
    close() {

    }
}
const { Manager } = require('socket.io-client');
class NodeClient {
    async connect(node) {
        let socketUrl = null, url = node.id
        try {
            const res = await axios.get(url + "/api/nodeinfo")
            if (res.data && res.data.pkey) {
                socketUrl = "http://" + res.data.domain + ":" + res.data.port
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
        this.socket.on('notification', (arg1, arg2) => {

        })
        this.socket.on('call', (arg1, arg2, cb) => {

        })
    }
    close() {

    }
}
module.exports = { NodeServer, NodeClient }