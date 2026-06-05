import tensorflow as tf
import os

# Create a simple Sequential model that mimics GhostFaceNet's input/output shape
model = tf.keras.Sequential([
    tf.keras.layers.InputLayer(input_shape=(112, 112, 3)),
    tf.keras.layers.GlobalAveragePooling2D(),
    tf.keras.layers.Dense(512)
])

# Convert the model to TFLite format
converter = tf.lite.TFLiteConverter.from_keras_model(model)
tflite_model = converter.convert()

# Ensure the directory exists
os.makedirs("assets/models", exist_ok=True)

# Save the dummy model
with open("assets/models/ghostfacenet.tflite", "wb") as f:
    f.write(tflite_model)

print("Dummy GhostFaceNet TFLite model generated successfully at assets/models/ghostfacenet.tflite")
