/*
    Toolbar to handle editing and other controls
    find css and index
*/

// given node id add. (should just be length of the list since it's always untaken)
function addNode() {
    console.log("Deleting Node")
}
  
//given node id delete.
function deleteNode() {
    console.log("Deleting Node")
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
