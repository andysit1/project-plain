"""Inventory: dicts keyed by SKU, sets, a history list, and loops over each.

Data layer: `stock` is dict[str, int], `catalog` is dict[str, Product],
`restock_log` is a list of (sku, qty) tuples built up by mutation.
"""
from shop.models import Product, PhysicalProduct, DigitalProduct


class Inventory:
    def __init__(self):
        self.catalog = {}
        self.stock = {}
        self.low_stock = set()
        self.restock_log = []

    def register(self, product: Product, qty: int):
        self.catalog[product.sku] = product
        self.stock[product.sku] = qty

    def take(self, sku: str, qty: int) -> bool:
        if self.stock.get(sku, 0) < qty:
            return False
        self.stock[sku] -= qty
        if self.stock[sku] < 5:
            self.low_stock.add(sku)
        return True

    def restock(self, sku: str, qty: int):
        self.stock[sku] = self.stock.get(sku, 0) + qty
        self.restock_log.append((sku, qty))
        self.low_stock.discard(sku)

    def value(self) -> float:
        total = 0.0
        for sku, qty in self.stock.items():
            total += self.catalog[sku].price * qty
        return total


def seed_inventory() -> Inventory:
    inv = Inventory()
    inv.register(PhysicalProduct("MUG-1", "Mug", 12.0, 0.4), 40)
    inv.register(PhysicalProduct("TEE-2", "T-shirt", 20.0, 0.2), 3)
    inv.register(DigitalProduct("EBK-3", "E-book", 9.0, "https://example.com/ebook"), 999)
    return inv


def price_report(inv: Inventory) -> dict[str, list[str]]:
    buckets = {"cheap": [], "mid": [], "premium": []}
    for sku, product in inv.catalog.items():
        if product.price < 10:
            buckets["cheap"].append(sku)
        elif product.price < 50:
            buckets["mid"].append(sku)
        else:
            buckets["premium"].append(sku)
    return buckets
