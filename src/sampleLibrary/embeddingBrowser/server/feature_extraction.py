import numpy as np
import librosa
from scipy.interpolate import interp1d
from sklearn.preprocessing import StandardScaler
from scipy.ndimage import gaussian_filter


def fold_features(features, fixed_length, sigma=2):
    n_features, n_frames = features.shape
    features_filtered = gaussian_filter(features, sigma=(0, sigma))

    step = n_frames // fixed_length
    features_folded = np.zeros((n_features, fixed_length))

    for i in range(fixed_length):
        start = i * step
        end = (i + 1) * step
        features_folded[:, i] = np.mean(features_filtered[:, start:end], axis=1)

    return features_folded


def process_features(features, fixed_length):
    n_features, n_frames = features.shape
    if n_frames < fixed_length:
        x = np.linspace(0, n_frames - 1, fixed_length)
        features_stretched = np.zeros((n_features, fixed_length))
        for i in range(n_features):
            interpolator = interp1d(range(n_frames), features[i], kind='linear', fill_value="extrapolate")
            features_stretched[i] = interpolator(x)
        return features_stretched
    elif n_frames > fixed_length:
        features_folded = fold_features(features, fixed_length)
        return features_folded
    else:
        return features


def extract_features(y, sr, feature_type='spectrogram', fixed_length=100, stretch_and_fold=True, fft_size=512):
    hop_length = fft_size // 8

    if feature_type in ('mfcc', 'both'):
        mfcc = librosa.feature.mfcc(y=y, sr=sr, n_fft=fft_size, hop_length=hop_length)
        if stretch_and_fold:
            mfcc_processed = process_features(mfcc, fixed_length)
        else:
            mfcc_processed = np.pad(mfcc, ((0, 0), (0, fixed_length - len(mfcc[0]))), mode='constant') if len(mfcc[0]) < fixed_length else mfcc[:, :fixed_length]

    if feature_type in ('spectrogram', 'both'):
        spectrogram = np.abs(librosa.stft(y, n_fft=fft_size, hop_length=hop_length))
        if stretch_and_fold:
            spectrogram_processed = process_features(spectrogram, fixed_length)
        else:
            spectrogram_processed = np.pad(spectrogram, ((0, 0), (0, fixed_length - len(spectrogram[0]))), mode='constant') if len(spectrogram[0]) < fixed_length else spectrogram[:, :fixed_length]

    if feature_type == 'both':
        features_concat = np.vstack((mfcc_processed, spectrogram_processed))
        return features_concat.ravel()
    elif feature_type == 'mfcc':
        return mfcc_processed.ravel()
    else:  # feature_type == 'spectrogram'
        return spectrogram_processed.ravel()
