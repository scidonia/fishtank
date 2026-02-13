#!/usr/bin/env python3
"""Generate a 1000x1000 ASCII map for Fish Tank with open areas."""

import random


def generate_map(width: int = 1000, height: int = 1000, seed: int = 42) -> list[str]:
    """Generate a more open map with scattered obstacles and house structures."""
    random.seed(seed)

    # Initialize with floors (inverted from before!)
    map_data = [["." for _ in range(width)] for _ in range(height)]

    # Track house locations to avoid overwriting them
    house_zones = []

    # Add border walls
    for x in range(width):
        map_data[0][x] = "#"
        map_data[height - 1][x] = "#"
    for y in range(height):
        map_data[y][0] = "#"
        map_data[y][width - 1] = "#"

    # FIRST: Define house generation function and track locations
    def add_house(cx: int, cy: int, house_width: int, house_height: int):
        """Add a rectangular house with walls and interior floor space."""
        # Track this house zone
        house_zones.append((cx, cy, house_width, house_height))

        # Clear the entire area around the house first
        for y in range(cy - 2, cy + house_height + 2):
            for x in range(cx - 2, cx + house_width + 2):
                if 1 <= x < width - 1 and 1 <= y < height - 1:
                    map_data[y][x] = "."

        # Fill interior with floor
        for y in range(cy, cy + house_height):
            for x in range(cx, cx + house_width):
                if 1 <= x < width - 1 and 1 <= y < height - 1:
                    map_data[y][x] = "."

        # Add outer walls
        for x in range(cx, cx + house_width):
            if 1 <= x < width - 1:
                map_data[cy][x] = "#"  # Top wall
                map_data[cy + house_height - 1][x] = "#"  # Bottom wall

        for y in range(cy, cy + house_height):
            if 1 <= y < height - 1:
                map_data[y][cx] = "#"  # Left wall
                map_data[y][cx + house_width - 1] = "#"  # Right wall

        # Add doorway (random side)
        door_side = random.randint(0, 3)
        if door_side == 0:  # Top
            door_x = cx + house_width // 2
            if 1 <= door_x < width - 1:
                map_data[cy][door_x] = "."
        elif door_side == 1:  # Right
            door_y = cy + house_height // 2
            if 1 <= door_y < height - 1:
                map_data[door_y][cx + house_width - 1] = "."
        elif door_side == 2:  # Bottom
            door_x = cx + house_width // 2
            if 1 <= door_x < width - 1:
                map_data[cy + house_height - 1][door_x] = "."
        else:  # Left
            door_y = cy + house_height // 2
            if 1 <= door_y < height - 1:
                map_data[door_y][cx] = "."

    # Generate houses of various sizes FIRST (before clearings)
    num_houses = 50
    house_sizes = [
        (6, 6),  # Small hut
        (8, 8),  # Medium house
        (10, 10),  # Large house
        (12, 8),  # Wide house
        (8, 12),  # Tall house
        (15, 12),  # Manor
    ]

    for _ in range(num_houses):
        house_width, house_height = random.choice(house_sizes)
        # Make sure houses don't spawn too close to edges
        cx = random.randint(50, width - house_width - 50)
        cy = random.randint(50, height - house_height - 50)
        add_house(cx, cy, house_width, house_height)

    print(f"  Generated {len(house_zones)} houses")

    # Add scattered wall clusters (like rocks, pillars, etc.) - avoid houses
    num_clusters = 200  # More clusters but smaller

    for _ in range(num_clusters):
        cx = random.randint(10, width - 10)
        cy = random.randint(10, height - 10)
        cluster_size = random.randint(3, 12)  # Varied sizes

        # Create irregular wall cluster
        for dy in range(-cluster_size, cluster_size + 1):
            for dx in range(-cluster_size, cluster_size + 1):
                x = cx + dx
                y = cy + dy

                if 1 <= x < width - 1 and 1 <= y < height - 1:
                    # Don't place clusters in/near houses
                    in_house = False
                    for hx, hy, hw, hh in house_zones:
                        if hx - 3 <= x <= hx + hw + 3 and hy - 3 <= y <= hy + hh + 3:
                            in_house = True
                            break

                    if not in_house:
                        dist = (dx * dx + dy * dy) ** 0.5
                        # Only place walls in roughly circular cluster, with randomness
                        if dist < cluster_size and random.random() < 0.4:
                            map_data[y][x] = "#"

    # Add some larger open "clearings" by removing walls - avoid houses
    num_clearings = 30
    for _ in range(num_clearings):
        cx = random.randint(50, width - 50)
        cy = random.randint(50, height - 50)
        clearing_radius = random.randint(15, 35)

        for dy in range(-clearing_radius, clearing_radius + 1):
            for dx in range(-clearing_radius, clearing_radius + 1):
                x = cx + dx
                y = cy + dy

                if 1 <= x < width - 1 and 1 <= y < height - 1:
                    dist = (dx * dx + dy * dy) ** 0.5
                    if dist < clearing_radius:
                        # Don't clear if this is a house zone
                        in_house = False
                        for hx, hy, hw, hh in house_zones:
                            if (
                                hx - 2 <= x <= hx + hw + 2
                                and hy - 2 <= y <= hy + hh + 2
                            ):
                                in_house = True
                                break
                        if not in_house:
                            map_data[y][x] = "."

    # Convert to strings
    return ["".join(row) for row in map_data]


if __name__ == "__main__":
    print("Generating 1000x1000 open map...")
    map_lines = generate_map()

    with open("map.txt", "w") as f:
        for line in map_lines:
            f.write(line + "\n")

    print(f"✓ Generated {len(map_lines)} lines, {len(map_lines[0])} columns")

    # Count features
    floors = sum(line.count(".") for line in map_lines)
    walls = sum(line.count("#") for line in map_lines)
    total = len(map_lines) * len(map_lines[0])

    print(f"  Floors: {floors:,} ({100 * floors / total:.1f}%)")
    print(f"  Walls:  {walls:,} ({100 * walls / total:.1f}%)")
