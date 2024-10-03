/*
    Toolbar to handle editing and other controls
    find css and index
*/

function addNode() {
    console.log("Adding Graph")
}
  
function clearGraph() {
    console.log("Clear Graph")
}

function saveGraph() {
    console.log("Saving Graph")
}


// Add event listeners to toolbar buttons
document.getElementById('addnote-btn').addEventListener('click', addNode);
document.getElementById('cleargraph-btn').addEventListener('click', clearGraph);
document.getElementById('save-btn').addEventListener('click', saveGraph);
