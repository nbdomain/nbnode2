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
    removePeerBySocket(socket_id) {
        for (const id in this.peers) {
            if (this.peers[id].socket.id === socket_id) {
                this.peers[id].socket.disconnect(true)
                delete this.peers[id]
            }
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
    relayEmit(des_id,event,args,ret) {
        const peers = this.peers
        if (!peers[des_id]) {
            console.error('peer:', des_id, " is not found")
            const ret = args[args.length - 1]
            if (typeof ret === 'function') {
                ret && ret({ code: 1000, msg: 'peer:' + des_id + " is not found" })
            }
            return
        }
        
        peers[des_id].socket.emit(event,args,(res)=>{
            ret(res)
        })
    }
}
module.exports = NBPeer