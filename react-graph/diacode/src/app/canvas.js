// import { useEffect, useRef, useState } from 'react';

// const NODE_CORNER_RADIUS = 8;
// const NODE_COLOR = '#552222';
// const NODE_BORDER_COLOR = '#555555';
// const NODE_HIGHLIGHT_COLOR = '#777777';
// const NODE_WIDTH = 150;
// const NODE_HEIGHT = 75;
// const NODE_TEXT_FONT = '12px Calibri';
// const NODE_TEXT_COLOR = '#CCCCCC';
// const NODE_ACTIVE_COLOR = '#556699';
// const LINE_COLOR = '#555555';
// const LINE_THICKNESS = 5;
// const LINE_SEPARATION = 16;
// const LINE_HIGHLIGHT = '#888888';
// const LINE_TEXT_FONT = '12px Calibri';
// const LAYER_ENTER_COLOR = '#559966';

// let graph;

// class Graph {
//   constructor(canvas) {
//     this.canvas = canvas;
//     this.width = canvas.width;
//     this.height = canvas.height;
//     this.activeLayer = 0;

//     this.states = [];
//     this.transitions = [];
//     this.subscribeEvents();

//     this.repaint = true;
//     requestAnimationFrame(() => this.animation());
//   }

//   clear() {
//     this.states = [];
//     this.transitions = [];
//     this.repaint = true;
//   }

//   subscribeEvents() {
//     this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
//     this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
//     this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
//   }

//   needsRepaint() {
//     if (this.repaint) {
//       return true;
//     }
//     if (this.canvas.clientWidth !== this.width || this.canvas.clientHeight !== this.height) {
//       return true;
//     }
//     return false;
//   }

//   animation() {
//     if (this.needsRepaint()) {
//       this.repaint = false;
//       this.drawScene();
//     }
//     requestAnimationFrame(() => this.animation());
//   }

//   drawScene() {
//     this.width = this.canvas.width = this.canvas.clientWidth;
//     this.height = this.canvas.height = this.canvas.clientHeight;

//     const ctx = this.canvas.getContext('2d');
//     this.drawBackground(ctx);

//     for (const state of this.states) {
//       state.drawActive(ctx);
//     }

//     for (const trans of this.transitions) {
//       trans.draw(ctx);
//     }

//     for (const state of this.states) {
//       state.draw(ctx);
//     }

//     for (const trans of this.transitions) {
//       trans.drawHover(ctx);
//     }
//   }

//   drawBackground(ctx) {
//     ctx.fillStyle = '#121212';
//     ctx.fillRect(0, 0, this.width, this.height);

//     ctx.lineWidth = 1;
//     ctx.strokeStyle = '#242424';
//     this.renderGrid(ctx, 25);

//     ctx.strokeStyle = '#363636';
//     this.renderGrid(ctx, 100);
//   }

//   renderGrid(ctx, step) {
//     for (let x = 0; x < this.width; x += step) {
//       ctx.beginPath();
//       ctx.moveTo(x, 0);
//       ctx.lineTo(x, this.height);
//       ctx.closePath();
//       ctx.stroke();
//     }

//     for (let y = 0; y < this.height; y += step) {
//       ctx.beginPath();
//       ctx.moveTo(0, y);
//       ctx.lineTo(this.width, y);
//       ctx.closePath();
//       ctx.stroke();
//     }
//   }

//   eventPos(event) {
//     const elem = this.canvas;
//     let top = 0;
//     let left = 0;

//     if (elem.getClientRects().length) {
//       const rect = elem.getBoundingClientRect();
//       const win = elem.ownerDocument.defaultView;

//       top = rect.top + win.pageYOffset;
//       left = rect.left + win.pageXOffset;
//     }

//     return {
//       x: event.pageX - left,
//       y: event.pageY - top,
//     };
//   }

//   onMouseMove(event) {
//     event.preventDefault();
//     const { x, y } = this.eventPos(event);

//     this.updateDrag(x, y);
//     this.updateHover(x, y);
//   }

//   updateDrag(x, y) {
//     if (!this.drag) {
//       return;
//     }

//     this.drag.target.rect.x = x - this.drag.mouseX + this.drag.startX;
//     this.drag.target.rect.y = y - this.drag.mouseY + this.drag.startY;
//     this.repaint = true;
//   }

//   updateHover(x, y) {
//     const mousePos = { x, y };

//     for (const state of this.states) {
//       const mousedOver = state.isInBounds(x, y);

//       if (mousedOver !== state.highlight) {
//         state.highlight = mousedOver;
//         this.repaint = true;
//       }
//     }

//     for (const trans of this.transitions) {
//       const mousedOver = trans.isInBounds(x, y);

//       if (mousedOver !== trans.highlight) {
//         trans.highlight = mousedOver;
//         this.repaint = true;
//       }

//       if (mousedOver) {
//         trans.mousePos = mousePos;
//         this.repaint = true;
//       }
//     }
//   }

//   onMouseDown(event) {
//     event.preventDefault();
//     const { x, y } = this.eventPos(event);

//     let targetState;
//     for (const state of this.states) {
//       if (state.isInBounds(x, y)) {
//         targetState = state;
//       }
//     }

//     if (!targetState) {
//       return;
//     }

//     this.drag = {
//       target: targetState,
//       startX: targetState.rect.x,
//       startY: targetState.rect.y,
//       mouseX: x,
//       mouseY: y,
//     };
//   }

//   onMouseUp(event) {
//     event.preventDefault();
//     this.drag = null;
//   }
// }

// class State {
//   constructor(id, name, rect, layer) {
//     this.id = id;
//     this.name = name;
//     this.rect = rect;
//     this.layer = layer;
//     this.highlight = false;
//     this.activeState = false;
//   }

//   draw(ctx) {
//     if (this.layer !== graph.activeLayer) {
//       return;
//     }

//     ctx.fillStyle = NODE_COLOR;
//     ctx.fillRect(this.rect.x, this.rect.y, this.rect.w, this.rect.h);
//   }

//   isInBounds(x, y) {
//     return x >= this.rect.x && x <= this.rect.x + this.rect.w && y >= this.rect.y && y <= this.rect.y + this.rect.h;
//   }
// }

// export default function DiagramPage() {
//     const canvasRef = useRef(null);

//     useEffect(() => {
//     const canvas = canvasRef.current;
//     if (canvas) {
//         graph = new Graph(canvas);
//         const newState = new State(1, 'Initial State', { x: 50, y: 50, w: NODE_WIDTH, h: NODE_HEIGHT }, 0);
//         graph.states.push(newState);
//     }
//     }, []);

//     console.log(graph.states)

//     return <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />;
// }
