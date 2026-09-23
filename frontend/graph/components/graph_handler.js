// this file will handle the nodes in the graph
// given id, it will delete, update, or change it
import { Rect, State, nextNodeId } from "./node.js"
import { Transition, TransitionGroup } from "./transition.js"
import { findFreeSpot } from "../utils/placement.js"

let nextTransitionId = 0

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


        //handles the 
        this.layerMachine = layerMachine

        //reference to graph states
        this.graph = layerMachine.graph
        this.previous_select = null
    }

    getLayerObject(){
        this.layerMachine.layer
    }

    // new nodes go in the nearest free slot to the middle of the view, never on top of another node
    addNode() {
        const taken = this.graph.states.concat(this.graph.obstacles())
        const spot = findFreeSpot(taken, NODE_WIDTH, NODE_HEIGHT, this.graph.viewCenter())
        const rect = new Rect(spot.x, spot.y, NODE_WIDTH, NODE_HEIGHT)

        const stateNode = new State(nextNodeId(), "Node", rect)
        this.graph.states.push(stateNode)
        this.graph.select(stateNode)
        this.graph.repaint = true
    }

    clearGraph() {
        const layer = this.layerMachine.get_current_layer()
        layer.states.length = 0
        layer.ts_manager.transitions_map.map = {}
        layer.updateTransitionsAndNestedGroups()
        this.layerMachine.load_layer(layer)
        this.graph.reset_selectors()
    }

    saveGraph() {
        this.layerMachine.display()
    }

    deleteNode() {
        const target = this.graph.select_active
        if (!target) { return }

        const layer = this.layerMachine.get_current_layer()
        const i = layer.states.indexOf(target)
        if (i !== -1) { layer.states.splice(i, 1) }
        layer.ts_manager.removeTransitionsFor(target)
        layer.updateTransitionsAndNestedGroups()
        this.layerMachine.load_layer(layer)
        this.graph.reset_selectors()
    }

    makeTransitions(){
    
        if (!this.graph.select_active || !this.graph.previous_select_active){
            return 
        }

        let state1 = this.graph.select_active
        let state2 = this.graph.previous_select_active
        if (state1 === state2) { return } // a node can't transition to itself (yet)

        const layer = this.layerMachine.get_current_layer()

        const t = new Transition(
            nextTransitionId++,
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
