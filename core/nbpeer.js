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
        const peers = this.peers
        if (!peers[id1] || !peers[id2]) {
            console.error('peer:', id1, id2, "is not registered")
            return false
        }
        peers[id1].pairPeer = id2
        peers[id2].pairPeer = id1
        return true
    }
    relayEmit(id, para, ret) {
        const peers = this.peers
        if (!peers[id]) {
            console.error('peer:', id, " is not found")
        }
        const id1 = peers[id].pairPeer
        peers[id1].socket.emit("data", para, ret1 => {
            console.log("got result from:",id1, ret1)
            ret&&ret(ret1)
        })
    }
}
module.exports = NBPeer