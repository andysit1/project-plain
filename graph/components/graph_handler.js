// this file will handle the nodes in the graph
// given id, it will delete, update, or change it
import { Rect, State,  } from "./node.js"
import { Transition, TransitionGroup } from "./transition.js"

//temp add
const NODE_WIDTH = 150
const NODE_HEIGHT = 75
// needs
    // states, id, 

// I think the graph manager should handle the layering aswell, atless have a reference to it.
export class GraphManager {
    constructor(layerMachine) {
        // Binding the methods to ensure 'this' refers to the class instance
        this.addNode = this.addNode.bind(this);
        this.deleteNode = this.deleteNode.bind(this);
        this.clearGraph = this.clearGraph.bind(this);
        this.saveGraph = this.saveGraph.bind(this);
        this.makeTransitions = this.makeTransitions.bind(this);

        this.layerMachine = layerMachine

        //reference to graph states
        this.graph = layerMachine.graph
        this.previous_select = null
    }

    getLayerObject(){
        this.layerMachine.layer
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
        console.log("Clearing Graph");
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
    
        if (!this.graph.select_active || !this.graph.previous_select_active){
            return 
        }

        let state1 = this.graph.select_active
        let state2 = this.graph.previous_select_active

        const layer = this.layerMachine.get_current_layer()

        const t = new Transition(
            1,
            "a auto transitions",
            state2,
            state1,
            layer.ts_manager.getTransitionGroup(state1, state2)
        )

        //add the layer to the correct hashmap
        layer.ts_manager.addTransition(state1, state2, t)

        //update and reload the layer... and then repaint so show the graph

        layer.updateTransitionsAndNestedGroups()
        this.layerMachine.load_layer(layer)
        this.graph.repaint = true
    }

}
