# OUTFIND - AI Powered Smart Wardrobe & Travel Assistant

## 📱 Project Overview
**OUTFIND** is a mobile application designed to solve the daily struggle of "What should I wear today?". Unlike traditional wardrobe apps, OUTFIND uses **Google Gemini AI** to automatically analyze and categorize user's clothes and suggests outfits based on real-time weather data fetched from **Open-Meteo**.

Additionally, it features a **Travel Packer** module that generates a customized packing list based on the weather forecast of the destination city.

**Target Audience:** People who want to organize their closet digitally, save time in the morning, and pack efficiently for trips.

---

## 🚀 Key Features

### 1. AI-Powered Closet Organizer
- Users can upload photos of their clothes.
- **Gemini 2.5 Flash AI** analyzes the image to automatically detect the **Category** (Top, Bottom, Shoes, Outer) and suitable **Weather Tags** (Cold, Mild, Warm, Rainy).
- Saves manual data entry time.

### 2. Dynamic Weather-Based Outfit Suggestions
- The Home screen fetches real-time weather data for the user's current city.
- Suggests a complete outfit (Top + Bottom + Outer + Shoes) from the user's closet that matches the current temperature and conditions.
- **"Shuffle"** feature allows users to see alternative combinations for the same weather.

### 3. Smart Travel Packing List
- Users enter a destination city and travel dates.
- The app fetches the historical/forecast weather for those specific dates.
- Generates a quantified packing list (e.g., "3x T-shirts, 1x Raincoat") based on the dominant weather conditions of the trip.

---

## 🛠 Tech Stack & Architecture

This project is built using **React Native** with **Expo**.

- **Core Framework:** React Native (Expo SDK 52)
- **Language:** TypeScript
- **AI Service:** Google Gemini API (`gemini-2.5-flash-image`)
- **Weather Data:** Open-Meteo API (Geocoding & Forecast)
- **Local Storage:** AsyncStorage (for persisting closet data and cities)
- **Styling:** StyleSheet & Expo Linear Gradient
- **Navigation:** React Navigation (Bottom Tabs)
- **Device Features:** Expo Image Picker (Camera/Gallery), Expo File System

---

## 📸 Screenshots

<img width="1691" height="847" alt="image" src="https://github.com/user-attachments/assets/4c5531d5-1c07-4ead-9dff-f526feb3ee18" />
<img width="957" height="2048" alt="image" src="https://github.com/user-attachments/assets/f277caa9-682b-4a08-93a4-356c2f035c8f" />
<img width="957" height="2048" alt="image" src="https://github.com/user-attachments/assets/355b2b1b-7273-4970-ae69-a5ad1d252ae7" />
<img width="957" height="2048" alt="image" src="https://github.com/user-attachments/assets/11fccb6c-ee77-4b32-b8a5-0e4414d1c854" />
<img width="957" height="2048" alt="image" src="https://github.com/user-attachments/assets/f75e5e60-879c-4886-abfd-40189288574e" />
<img width="957" height="2048" alt="image" src="https://github.com/user-attachments/assets/9846d871-af75-4da2-ac88-58999429cb85" />


# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
