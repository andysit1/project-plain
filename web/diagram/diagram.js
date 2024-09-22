



import Graph from "./components/graph.js"


function init(){
    const canvas = document.getElementById('graph')
    graph = new Graph(canvas)
    graph.repaint = true
}

