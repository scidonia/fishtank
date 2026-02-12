#!/usr/bin/env python3
"""Generate a 1000x1000 ASCII map for Fish Tank."""
import random

def generate_map(width: int = 1000, height: int = 1000, seed: int = 42) -> list[str]:
    """Generate a procedural dungeon map."""
    random.seed(seed)
    
    # Initialize with walls
    map_data = [['#' for _ in range(width)] for _ in range(height)]
    
    # Create rooms
    num_rooms = 50
    rooms = []
    
    for _ in range(num_rooms):
        # Random room size
        room_w = random.randint(10, 40)
        room_h = random.randint(10, 40)
        room_x = random.randint(1, width - room_w - 1)
        room_y = random.randint(1, height - room_h - 1)
        
        # Carve out room
        for y in range(room_y, room_y + room_h):
            for x in range(room_x, room_x + room_w):
                map_data[y][x] = '.'
        
        rooms.append((room_x, room_y, room_w, room_h))
    
    # Connect rooms with corridors
    for i in range(len(rooms) - 1):
        x1, y1, w1, h1 = rooms[i]
        x2, y2, w2, h2 = rooms[i + 1]
        
        # Center points
        cx1, cy1 = x1 + w1 // 2, y1 + h1 // 2
        cx2, cy2 = x2 + w2 // 2, y2 + h2 // 2
        
        # Horizontal corridor
        for x in range(min(cx1, cx2), max(cx1, cx2) + 1):
            map_data[cy1][x] = '.'
        
        # Vertical corridor
        for y in range(min(cy1, cy2), max(cy1, cy2) + 1):
            map_data[y][cx2] = '.'
    
    # Add some interesting features
    # Scatter some pillars in rooms
    for _ in range(100):
        x = random.randint(1, width - 2)
        y = random.randint(1, height - 2)
        if map_data[y][x] == '.' and random.random() < 0.3:
            map_data[y][x] = '#'
    
    # Convert to strings
    return [''.join(row) for row in map_data]

if __name__ == '__main__':
    print("Generating 1000x1000 map...")
    map_lines = generate_map()
    
    with open('map.txt', 'w') as f:
        for line in map_lines:
            f.write(line + '\n')
    
    print(f"✓ Generated {len(map_lines)} lines, {len(map_lines[0])} columns")
    
    # Count features
    floors = sum(line.count('.') for line in map_lines)
    walls = sum(line.count('#') for line in map_lines)
    total = len(map_lines) * len(map_lines[0])
    
    print(f"  Floors: {floors:,} ({100*floors/total:.1f}%)")
    print(f"  Walls:  {walls:,} ({100*walls/total:.1f}%)")
