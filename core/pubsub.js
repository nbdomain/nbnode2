const { createChannel } = require("better-sse")

class PubSub {
    constructor(indexers) {
        this.tickers = {}
        this.indexers = indexers
    }
    subscribe(topic, session) {
        if (!this.tickers[topic]) this.tickers[topic] = createChannel()
        this.tickers[topic].register(session)
    }
    publish(topic, msg, id = null) {
        if (this.tickers[topic]) { //notify subscribers
            this.tickers[topic].broadcast('update', msg)
        }
        if (broadcast) {
            this.indexers.Nodes.notifyPeers({ cmd: "publish", id, data: { topic, msg } })
        }
    }
}
module.exports = PubSub