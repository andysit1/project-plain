"""Graphs two ways: object nodes with a neighbours list (detected as a graph),
and a plain adjacency dict walked by breadth-first search."""
from collections import deque


class Vertex:
    def __init__(self, name: str):
        self.name = name
        self.neighbors: list["Vertex"] = []

    def connect(self, other: "Vertex"):
        self.neighbors.append(other)
        other.neighbors.append(self)


def bfs(adjacency: dict[str, list[str]], start: str) -> list[str]:
    visited = set()
    order = []
    queue = deque([start])
    while queue:
        current = queue.popleft()
        if current in visited:
            continue
        visited.add(current)
        order.append(current)
        for neighbor in adjacency[current]:
            queue.append(neighbor)
    return order


def degree_counts(adjacency: dict[str, list[str]]) -> dict[str, int]:
    degrees = {}
    for vertex, edges in adjacency.items():
        degrees[vertex] = len(edges)
    return degrees
