const { Server } = require('socket.io')
const axios = require('axios')

class NodeServer {
    start(httpServer) {
        const io = new Server()
        io.attach(httpServer)
        io.on("connection", (socket) => {
            console.log(socket.handshake.auth); //
            socket.on("hello", (data, ret) => {
                console.log("got hello data:", data)
                ret("hahahah")
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
                console.log('Connected!');
                const datav = Date.now().toString()
                socket.emit("hello", datav, (res) => {
                    console.log("reply from hello:", res)
                })
                this.socket = socket
                this._setup()
                resolve(true)
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