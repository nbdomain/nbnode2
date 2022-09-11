class NBPeer {
    constructor() {
        this.peers = {} //peer list
    }
    getPeer(id) {
        return this.peers[id]
    }
    addPeer(id, socket) {
        this.removePeer(id)
        this.peers[id] = { id, socket }
        return id
    }
    removePeer(id) {
        if (this.peers[id]) {
            this.peers[id].socket.disconnect(true)
            delete this.peers[id]
        }
    }
    async connectPeer({ fromID, toID, info }) {
        const peers = this.peers
        if (!peers[fromID] || !peers[toID]) {
            console.error('peer:', from, to, "is not registered")
            return false
        }
        return new Promise(resolve => {
            peers[toID].socket.emit("request_connect", info, (res) => {
                if (res && res.code == 0) {
                    peers[fromID].pairPeer = toID
                    peers[toID].pairPeer = fromID
                }
                resolve(res)
            })
        })
    }
    relayEmit(id, para, ret) {
        const peers = this.peers
        if (!peers[id]) {
            console.error('peer:', id, " is not found")
            return { code: 1, msg: 'peer:' + id + " is not found" }
        }
        const id1 = peers[id].pairPeer
        peers[id1].socket.emit("data", para, ret1 => {
            console.log("got result from:", id1, ret1)
            ret && ret(ret1)
        })
    }
}
module.exports = NBPeer