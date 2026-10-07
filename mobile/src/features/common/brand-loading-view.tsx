import { StatusBar } from 'expo-status-bar';
import { Image, StyleSheet, View } from 'react-native';

// Match the native splash plugin's image, width and background.
export function BrandLoadingView() {
  return (
    <View style={styles.page} accessibilityLabel="앱 로딩 중" accessibilityRole="progressbar">
      <StatusBar style="dark" />
      <Image
        source={require('../../../assets/taejang-launcher-icon.png')}
        resizeMode="contain"
        style={styles.logo}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FDFCFD' },
  logo: { width: 224, height: 224, maxWidth: '80%', aspectRatio: 1 },
});
