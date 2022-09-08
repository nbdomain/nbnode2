const { prepare } = require("nbpay")

class NBPeer {
    constructor() {
        this.peers = {} //peer list
    }
    addPeer(peer,socket) {
        if(!peer.id)peer.id = socket.id
        this.peers[peer.id] = peer
        peer.socket = socket
        return peer.id
    }
    connectPeer(id1, id2) {
        const peer = this.peer
        if (!peers[id1] || !peers[id2]) {
            console.error('peer:', id1, id2, "is not registered")
        }
        peers[id1].pairPeer = id2
        peers[id2].pairPeer = id1
    }
    relayEmit(id, name, para, ret) {
        const peer = this.peer
        if (!peer[id]) {
            console.error('peer:', id, " is not found")
        }
        const id1 = peer[id].pairPeer
        peer[id1].socket.emit("receive",name, para, ret1 => {
            console.log("got result from:",id1, ret1)
            ret(ret1)
        })
    }
}
module.exports = NBPeer