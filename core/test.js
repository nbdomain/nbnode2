const { Manager } = require('socket.io-client')
const socketUrl = "http://localhost:9001/"
const manager = new Manager(socketUrl, { autoConnect: false });
const socket = manager.socket("/");
socket.auth = { username: "abc", key: "456" }
manager.open((err) => {
  if (err) {
    console.error(err)

  } else {
    console.log("manager connected")
  }
});
socket.connect()