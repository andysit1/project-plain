export class PairHashMap {
    constructor() {
        this.map = {};
    }


    /**
     * Creates a canonical key from two values.
     * @param {any} a - The first value.
     * @param {any} b - The second value.
     * @returns {string} A sorted string representation of the pair.
     */
    _createKey(a, b) {
        // Use an array, sort it, and join it to create a unique key
        return [a, b].sort().join('-');
    }

    /**
     * Adds a value to the HashMap for a specific pair.
     * @param {any} a - The first value.
     * @param {any} b - The second value.
     * @param {any} value - The value to store for the pair.
     */
    set(a, b, value) {
        const key = this._createKey(a, b);
        this.map[key] = value;
    }

    /**
     * Retrieves a value from the HashMap for a specific pair.
     * @param {any} a - The first value.
     * @param {any} b - The second value.
     * @returns {any} The value stored for the pair, or undefined if not found.
     */
    get(a, b) {
        const key = this._createKey(a, b);
        return this.map[key];
    }

    /**
     * Removes a value from the HashMap for a specific pair.
     * @param {any} a - The first value.
     * @param {any} b - The second value.
     */
    delete(a, b) {
        const key = this._createKey(a, b);
        delete this.map[key];
    }

    /**
     * Lists all pairs in the HashMap.
     * @returns {Array} An array of objects representing the pairs and their values.
     */
    list() {
        return Object.entries(this.map).map(([key, value]) => {
            const [a, b] = key.split('-');
            console.log(value)
            return { pair: [a, b], value };
        });
    }
}

// // Example usage
// const pairMap = new PairHashMap();

// // Adding values
// pairMap.set('A', 'B', 'Value 1');
// pairMap.set('B', 'A', 'Value 2'); // This will overwrite Value 1

// // Retrieving values
// console.log(pairMap.get('A', 'B')); // Output: 'Value 2'
// console.log(pairMap.get('B', 'A')); // Output: 'Value 2'

// // Listing all pairs
// console.log(pairMap.list()); // Output: [ { pair: [ 'A', 'B' ], value: 'Value 2' } ]

// // Deleting a pair
// pairMap.delete('A', 'B');
// console.log(pairMap.get('A', 'B')); // Output: undefined
