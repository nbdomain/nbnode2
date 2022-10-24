const { createChannel } = require("better-sse")

class PubSub {
    constructor(indexers) {
        this.tickers = {}
        this.indexers = indexers
        this.sendMap = {}
    }
    subscribe(topic, session) {
        if (!this.tickers[topic]) this.tickers[topic] = createChannel()
        this.tickers[topic].register(session)
    }
    publish(topic, msg, id = null) {
        if (!id) id = Date.now().toString(36)
        if (this.tickers[topic] && !this.sendMap[id]) { //notify subscribers
            this.tickers[topic].broadcast('pubsub', msg)
            this.sendMap[id] = true
        }
        this.indexers.Nodes.notifyPeers({ cmd: "publish", id, data: { topic, msg } })
    }
}
module.exports = PubSub