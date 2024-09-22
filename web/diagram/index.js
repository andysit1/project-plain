



import Graph from "./components/graph.js"

function init(){
    console.log("Init Function")
    const canvas = document.getElementById('graph')
    graph = new Graph(canvas)
    graph.repaint = true
}

document.addEventListener('DOMContentLoaded', init);
