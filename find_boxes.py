import cv2
import numpy as np
import json

def find_slots():
    # Load image
    img = cv2.imread('c:/Users/alway/Idle-RPG/images/Character UI.png')
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # Thresholding to find the brown/light frames
    # The inner part of slots are lighter
    _, thresh = cv2.threshold(gray, 100, 255, cv2.THRESH_BINARY)
    
    # Find contours
    contours, _ = cv2.findContours(thresh, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    
    boxes = []
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        area = w * h
        # We know image is 1024x1280 (1.3M pixels)
        # The slots should have areas between 10000 and 150000
        if 8000 < area < 150000 and w > 80 and h > 80:
            boxes.append((x, y, w, h))
            
    # Filter overlapping boxes (keep the ones that contain the lighter inner part, usually we get inner and outer contours)
    # Sort by area descending
    boxes.sort(key=lambda b: b[2]*b[3], reverse=True)
    filtered_boxes = []
    for b in boxes:
        overlap = False
        for fb in filtered_boxes:
            # Check if b is inside fb
            if b[0] >= fb[0]-10 and b[1] >= fb[1]-10 and (b[0]+b[2]) <= (fb[0]+fb[2]+10) and (b[1]+b[3]) <= (fb[1]+fb[3]+10):
                overlap = True
                break
            # Check if fb is inside b
            if fb[0] >= b[0]-10 and fb[1] >= b[1]-10 and (fb[0]+fb[2]) <= (b[0]+b[2]+10) and (fb[1]+fb[3]) <= (b[1]+b[3]+10):
                overlap = True
                break
        if not overlap:
            filtered_boxes.append(b)
            
    # Sort boxes top to bottom, left to right
    filtered_boxes.sort(key=lambda b: (b[1]//100, b[0]))
    
    for i, (x, y, w, h) in enumerate(filtered_boxes):
        print(f"Box {i+1}: left={x/1024*100:.2f}%, top={y/1280*100:.2f}%, width={w/1024*100:.2f}%, height={h/1280*100:.2f}% (x={x}, y={y}, w={w}, h={h})")

if __name__ == '__main__':
    find_slots()
