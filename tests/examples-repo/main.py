"""Entry point that ties the examples together, so the functions layer has cross-module calls."""
from shop.models import Address, Customer, Order
from shop.inventory import seed_inventory, price_report
from algos.linked_list import LinkedList
from algos.bst import BST
from algos.graph import Vertex, bfs, degree_counts
from algos.matrix import multiply, row_sums, transpose
from algos.lru_cache import LRUCache


def checkout_demo() -> float:
    inv = seed_inventory()
    home = Address("1 Main St", "Springfield", "12345")
    alice = Customer("Alice", "alice@example.com", home)
    order = Order(1, alice)
    for sku in ["MUG-1", "EBK-3"]:
        if inv.take(sku, 1):
            order.add(inv.catalog[sku])
    report = price_report(inv)
    return order.total() + len(report)


def structures_demo() -> list[int]:
    items = LinkedList()
    for n in [3, 1, 4, 1, 5]:
        items.push_front(n)
    items.reverse()

    tree = BST()
    for key in items.to_list():
        tree.insert(key, str(key))

    cache = LRUCache(2)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.get("a")
    cache.put("c", 3)
    return tree.in_order()


def graph_demo() -> list[str]:
    a, b, c = Vertex("a"), Vertex("b"), Vertex("c")
    a.connect(b)
    b.connect(c)
    adjacency = {"a": ["b"], "b": ["a", "c"], "c": ["b"]}
    degree_counts(adjacency)
    return bfs(adjacency, "a")


def matrix_demo() -> list[float]:
    m = [[1.0, 2.0], [3.0, 4.0]]
    return row_sums(multiply(m, transpose(m)))


if __name__ == "__main__":
    print(checkout_demo(), structures_demo(), graph_demo(), matrix_demo())
