"""Nested lists as 2-D grids: nested loops show as row and column cursors."""


def zeros(rows: int, cols: int) -> list[list[float]]:
    grid = []
    for r in range(rows):
        row = []
        for c in range(cols):
            row.append(0.0)
        grid.append(row)
    return grid


def transpose(m: list[list[float]]) -> list[list[float]]:
    out = []
    for c in range(len(m[0])):
        col = []
        for r in range(len(m)):
            col.append(m[r][c])
        out.append(col)
    return out


def multiply(a: list[list[float]], b: list[list[float]]) -> list[list[float]]:
    result = zeros(len(a), len(b[0]))
    for i in range(len(a)):
        for j in range(len(b[0])):
            for k in range(len(b)):
                result[i][j] += a[i][k] * b[k][j]
    return result


def row_sums(m: list[list[float]]) -> list[float]:
    sums = []
    for row in m:
        total = 0.0
        for value in row:
            total += value
        sums.append(total)
    return sums
