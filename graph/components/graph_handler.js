// this file will handle the nodes in the graph
// given id, it will delete, update, or change it
import { Rect, State,  } from "./node.js"
import { Transition, TransitionGroup } from "./transition.js"

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
        this.makeTransitions = this.makeTransitions.bind(this);

        //reference to graph states
        this.graph = graph
        this.previous_select = null
    }

    addNode() {
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


    clearGraph() {
        console.log("Clearing Graph")
    }

    saveGraph() {
        console.log("Saving Graph");
        console.log(this.graph.states)
    }

    deleteNode() {
        console.log(this.graph)
        if (this.graph.select_active != null){
            console.log("Deleting", this.graph.select_active)
            return
        }
        console.log("None Selected")
    }

    makeTransitions(){
        console.log('transitions')
        console.log(this.graph)
        if (this.graph.select_active){
            console.log(this.graph.select_active)
        }
        if (this.graph.previous_select_active){
            console.log(this.graph.previous_select_active)
        }

        let state1 = this.graph.select_active
        let state2 = this.graph.previous_select_active


        const t_group = new TransitionGroup(state1, state2)
        const t = new Transition("1", "transition 1", state2, state1, t_group)

        t_group.transitions.push(t)
        this.graph.transitions.push(t)
        this.graph.repaint = true
    }

}
