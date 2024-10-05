// this file will handle the nodes in the graph
// given id, it will delete, update, or change it
import { Rect, State,  } from "./node.js"

//temp add
const NODE_WIDTH = 150
const NODE_HEIGHT = 75
// needs
    // states, id, 

export class GraphManager {
    constructor(graph) {
        // Binding the methods to ensure 'this' refers to the class instance
        this.addNode = this.addNode.bind(this);
        this.deleteNode = this.deleteNode.bind(this);
        this.clearGraph = this.clearGraph.bind(this);
        this.saveGraph = this.saveGraph.bind(this);


        //reference to graph states
        this.graph = graph
    }

    addNode() {
        console.log("Adding Node");
        let startX = 400
        let startY = 400

        //temp added logic here... well abstract into node handler in future.
        const rect = new Rect(
            startX,
            startY,
            NODE_WIDTH,
            NODE_HEIGHT
        )
                
        const stateNode = new State(this.graph.states.length, "Node", rect)
        this.graph.states.push(stateNode)
        this.graph.repaint = true
    }

    deleteNode() {
        console.log("Deleting Node");
        if (this.graph.select_active != null){
            console.log("Deleting", this.graph.select_active)
            return
        }
        console.log("None Selected")
    }

    clearGraph() {
        console.log("Clearing Graph");
    }

    saveGraph() {
        console.log("Saving Graph");
        console.log(this.graph.states)
    }
}
