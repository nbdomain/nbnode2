const cluster = require('cluster');
const numCPUs = require('os').cpus().length;
const http = require("http");
const { setupMaster, setupWorker } = require("@socket.io/sticky");
const { createAdapter, setupPrimary } = require("@socket.io/cluster-adapter");

console.log("Run in cluster mode ...")
if (cluster.isMaster) {
    console.log(`Master ${process.pid} is running`);

    /*const httpServer = http.createServer();

    // setup sticky sessions
    setupMaster(httpServer, {
        loadBalancingMethod: "least-connection",
    });

    // setup connections between the workers
    setupPrimary();

    // needed for packets containing buffers (you can ignore it if you only send plaintext objects)
    // Node.js < 16.0.0
    //cluster.setupMaster({
    //    serialization: "advanced",
    //});
    // Node.js > 16.0.0
    cluster.setupPrimary({
        serialization: "advanced",
    });

    httpServer.listen(9001); */
    for (var i = 0; i < numCPUs; i++) {
        process.env.START_SEQUENCE = i
        cluster.fork();
    }
    // 其它代码
    /*cluster.on("exit", (worker) => {
        console.log(`Worker ${worker.process.pid} died`);
        cluster.fork();
    }); */
} else {
    const indexers = require("./index.js");
    indexers.clusterNumber = process.env.START_SEQUENCE
}