#!/bin/bash

PRODUCT='{
  "Stock": "3226",
  "Stock_No": "3226",
  "Brand": "ROLEX",
  "Model": "OYSTER PERPETUAL",
  "MM": "26",
  "Metal": "STEEL",
  "Bracelet": "OYSTER",
  "Dial": "SILVER",
  "Bezel": "SMOOTH",
  "Condition": "PRE OWNED",
  "Links": "FULL",
  "Box": "NO",
  "Paper": "NO",
  "Reference": "6718",
  "Year": "",
  "Comment": "NAKED",
  "Movement": "AUTOMATIC",
  "Case": "STEEL",
  "Availability": "G",
  "Price": "3300",
  "Buy_Price": "3300",
  "DnaLink": "https://dna.dnalinks.in/w/3226",
  "VideoLink": "https://dnalinks.in/3226.mp4",
  "ImageLink": "https://dnalinks.in/3226.jpg",
  "ImageLink1": "https://dnalinks.in/3226_1.jpg",
  "ImageLink2": "https://dnalinks.in/3226_2.jpg"
}'

echo "Testing product 3226 with all 3 images..."
DIRECT_PRODUCT="$PRODUCT" node tests/test-create-product.js
