



import Graph from "./components/graph.js"
import {Rect, State} from "./components/node.js"

const NODE_WIDTH = 150
const NODE_HEIGHT = 75

function init(){
    console.log("Init Function")
    const canvas = document.getElementById('graph')
    let graph = new Graph(canvas)

    let startX = 400
    let startY = 400

    let originX = 0
    let originY = 0

    const rect = new Rect(
        startX,
        startY,
        NODE_WIDTH,
        NODE_HEIGHT
      )
    

    const rect2 = new Rect(
      originX,
      originY,
      NODE_WIDTH,
      NODE_HEIGHT
    )

    const stateNode = new State(0, "Home", rect)
    const stateNode1 = new State(1, "Origin", rect2)

    graph.states.push(stateNode)  
    graph.states.push(stateNode1)
    graph.repaint = true
}

document.addEventListener('DOMContentLoaded', init);


