// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList, Image,
  Keyboard,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet, Text,
  TextInput, TouchableOpacity,
  View
} from 'react-native';

// --- ÖNEMLİ: Dosya okuma hatasını çözen Legacy Import ---
import * as FileSystem from 'expo-file-system/legacy';

import AsyncStorage from '@react-native-async-storage/async-storage';

// --- LÜTFEN GEMINI KEYİNİ BURAYA YAPIŞTIR ---
const GEMINI_API_KEY = "YOUR_GEMINI_API_KEY_HERE"; 

export default function App() {
  const [city, setCity] = useState('');
  const [cityData, setCityData] = useState([]);
  const [closet, setCloset] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadCloset();
  }, []);

  const loadCloset = async () => {
    try {
      const saved = await AsyncStorage.getItem('ai_closet_v14'); // Versiyon 14 (Temiz liste)
      if (saved) setCloset(JSON.parse(saved));
    } catch (e) { console.log("Yükleme hatası"); }
  };

  const fetchWeather = async () => {
    if (!city) return;
    try {
      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${city.trim()}&count=1&language=tr&format=json`);
      const geoData = await geoRes.json();
      if (!geoData.results) { Alert.alert("Hata", "Şehir bulunamadı!"); return; }

      const { latitude, longitude, name } = geoData.results[0];
      const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`);
      const wData = await wRes.json();

      const newCity = {
        id: Math.random().toString(),
        name: name,
        temp: wData.current_weather.temperature,
        isRainy: wData.current_weather.weathercode >= 51
      };
      setCityData([newCity, ...cityData]);
      setCity('');
      Keyboard.dismiss();
    } catch (err) { Alert.alert("Hata", "Hava durumu verisi alınamadı."); }
  };

  const analyzeWithGemini = async (base64Data) => {
    // --- GÜNCELLEME BURADA: Model ismini '-latest' olarak değiştirdik ---
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
    
    const payload = {
      contents: [{
        parts: [
          { text: "Analyze this clothing image. Determine if it is for cold, mild, warm, or rainy weather. Answer with ONLY one of these words: cold, mild, warm, rainy." },
          { inline_data: { mime_type: "image/jpeg", data: base64Data } }
        ]
      }]
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await res.json();
    
    // Google'dan gelen hatayı net görmek için:
    if (result.error) {
        console.log("API Error Detayı:", result.error);
        throw new Error(result.error.message || "API Model Hatası");
    }

    // Cevap kontrolü
    if (!result.candidates || !result.candidates[0] || !result.candidates[0].content) {
        throw new Error("AI geçerli bir cevap döndürmedi.");
    }

    const aiText = result.candidates[0].content.parts[0].text.toLowerCase();
    if (aiText.includes('cold')) return 'cold';
    if (aiText.includes('warm')) return 'warm';
    if (aiText.includes('rainy')) return 'rainy';
    return 'mild';
  };

  const pickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert("İzin Gerekli", "Galeri erişimi izni vermeniz gerekiyor.");
        return;
      }

      let result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images, 
        allowsEditing: true,
        quality: 0.3,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) return;

      setLoading(true);
      const selectedUri = result.assets[0].uri;

      // Legacy modda manuel 'base64' stringi kullanarak okuma
      const base64 = await FileSystem.readAsStringAsync(selectedUri, { 
        encoding: 'base64' 
      });

      const category = await analyzeWithGemini(base64);
      
      const newItem = {
        id: Date.now().toString(),
        image: selectedUri,
        type: category
      };

      const updatedCloset = [newItem, ...closet];
      setCloset(updatedCloset);
      await AsyncStorage.setItem('ai_closet_v14', JSON.stringify(updatedCloset));
      
      Alert.alert("Başarılı", `AI bu kıyafeti ${category.toUpperCase()} olarak algıladı.`);
    } catch (err) {
      Alert.alert("Hata", "İşlem hatası: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <LinearGradient colors={['#1e3c72', '#2a5298']} style={styles.header}>
        <SafeAreaView>
          <Text style={styles.title}>AI Stil Asistanı</Text>
          <View style={styles.searchBar}>
            <TextInput style={styles.input} placeholder="Şehir Ara..." value={city} onChangeText={setCity} placeholderTextColor="#999" />
            <TouchableOpacity onPress={fetchWeather} style={styles.searchBtn}>
              <Ionicons name="search" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <View style={styles.actionRow}>
        <Text style={styles.stats}>{closet.length} Kıyafet Yüklü</Text>
        <TouchableOpacity style={styles.mainAddBtn} onPress={pickImage} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : (
            <><Ionicons name="camera" size={20} color="#fff" /><Text style={styles.addText}>AI İle Ekle</Text></>
          )}
        </TouchableOpacity>
      </View>

      <FlatList
        data={cityData}
        keyExtractor={item => item.id}
        renderItem={({ item }) => {
          const suggested = closet.filter(c => {
            if (item.isRainy) return c.type === 'rainy';
            if (item.temp < 15) return c.type === 'cold';
            if (item.temp < 25) return c.type === 'mild';
            return c.type === 'warm';
          });

          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cityName}>{item.name}</Text>
                <Text style={styles.tempText}>{Math.round(item.temp)}°C</Text>
              </View>
              <Text style={styles.label}>BU HAVA İÇİN ÖNERİLER:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {suggested.length > 0 ? suggested.map(s => (
                  <Image key={s.id} source={{ uri: s.image }} style={styles.clothImg} />
                )) : <Text style={styles.emptyText}>Henüz uygun bir AI analizi bulunamadı.</Text>}
              </ScrollView>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  header: { padding: 20, borderBottomLeftRadius: 30, borderBottomRightRadius: 30, paddingBottom: 40 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff', textAlign: 'center', marginTop: 10 },
  searchBar: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 15, marginTop: 25, alignItems: 'center', paddingHorizontal: 15 },
  input: { flex: 1, height: 50, color: '#000' },
  searchBtn: { backgroundColor: '#1e3c72', padding: 10, borderRadius: 10 },
  actionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20 },
  stats: { color: '#333', fontWeight: 'bold' },
  mainAddBtn: { flexDirection: 'row', backgroundColor: '#4ECCA3', padding: 12, borderRadius: 15, alignItems: 'center' },
  addText: { color: '#fff', fontWeight: 'bold', marginLeft: 8 },
  card: { backgroundColor: '#fff', margin: 15, borderRadius: 25, padding: 20, elevation: 4 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  cityName: { fontSize: 22, fontWeight: 'bold' },
  tempText: { fontSize: 28, fontWeight: '300' },
  label: { fontSize: 10, fontWeight: 'bold', color: '#bbb', marginBottom: 15 },
  clothImg: { width: 100, height: 130, borderRadius: 15, marginRight: 15, backgroundColor: '#eee' },
  emptyText: { color: '#bbb', fontSize: 12, fontStyle: 'italic', marginTop: 10 }
});