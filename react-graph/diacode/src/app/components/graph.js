// components/Canvas.js
"use client"

import { useRef, useEffect } from "react";

const Canvas = () => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    // Set canvas dimensions
    canvas.width = 500;
    canvas.height = 500;

    // Example: Draw a blue rectangle
    ctx.fillStyle = "blue";
    ctx.fillRect(50, 50, 100, 100);

    // Animation loop example
    let requestId;
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear the canvas
      // Your animation logic here
      ctx.fillStyle = "red";
      ctx.fillRect(100, 100, 150, 150); // Draw a red rectangle

      requestId = requestAnimationFrame(animate);
    };

    animate(); // Start the animation

    // Cleanup function to cancel the animation when the component unmounts
    return () => {
      cancelAnimationFrame(requestId);
    };
  }, []);

  return <canvas ref={canvasRef} style={{ border: "1px solid black" }} />;
};

export default Canvas;
