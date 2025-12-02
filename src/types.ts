export interface VersionXmlns {
    version: string;
    xmlns:   string;
}

export interface MotionDetectionRoot {
    MotionDetection: MotionDetection;
}

export interface MotionDetection {
    $:                      VersionXmlns;
    enabled:                EnabledHighlight[];
    enableHighlight:        EnabledHighlight[];
    samplingInterval:       string[];
    startTriggerTime:       string[];
    endTriggerTime:         string[];
    regionType:             RegionType[];
    Grid:                   Grid[];
    MotionDetectionLayout:  MotionDetectionLayout[];
}

export interface EnabledHighlight {
    _: string;
    $: EnabledOpt;
}

export interface EnabledOpt {
    opt: string;
}

export interface Grid {
    rowGranularity:    string[];
    columnGranularity: string[];
}

export interface MotionDetectionLayout {
    sensitivityLevel: SensitivityLevel[];
    layout:           Layout[];
}

export interface Layout {
    gridMap: string[];
}

export interface SensitivityLevel {
    _: string;
    $: SensitivityLevelOpt;
}

export interface SensitivityLevelOpt {
    min:  string;
    max:  string;
    step: string;
}

export interface RegionType {
    _: string;
    $: RegionTypeOpt;
}

export interface RegionTypeOpt {
    opt: string;
}

export interface StreamingChannelListRoot {
    StreamingChannelList: StreamingChannelList;
}

export interface StreamingChannelList {
    $:                VersionXmlns;
    StreamingChannel: StreamingChannel[];
}

export interface StreamingChannel {
    $:           VersionXmlns;
    id:          string[];
    channelName: string[];
    enabled:     string[];
    Transport:   Transport[];
    Video:       Video[];
    Audio:       Audio[];
}

export interface Audio {
    enabled:               string[];
    audioInputChannelID:   string[];
    audioCompressionType: string[];
}

export interface Transport {
    maxPacketSize:        string[];
    ControlProtocolList:  ControlProtocolList[];
    Unicast:              Unicast[];
    Multicast:            Multicast[];
    Security:             Security[];
    SRTPMulticast:        SRTPMulticast[];
}

export interface ControlProtocolList {
    ControlProtocol: ControlProtocol[];
}

export interface ControlProtocol {
    streamingTransport: string[];
}

export interface Multicast {
    enabled:         string[];
    destIPAddress:   string[];
    videoDestPortNo: string[];
    audioDestPortNo: string[];
}

export interface SRTPMulticast {
    SRTPVideoDestPortNo: string[];
    SRTPAudioDestPortNo: string[];
}

export interface Security {
    enabled:           string[];
    certificateType:   string[];
    SecurityAlgorithm: SecurityAlgorithm[];
}

export interface SecurityAlgorithm {
    algorithmType: string[];
}

export interface Unicast {
    enabled:          string[];
    rtpTransportType: string[];
}

export interface Video {
    enabled:                 string[];
    videoInputChannelID:     string[];
    videoCodecType:          string[];
    videoScanType:           string[];
    videoResolutionWidth:    string[];
    videoResolutionHeight:   string[];
    videoQualityControlType: string[];
    constantBitRate:         Array<string | { _: string; $: { min: string; max: string } }>;
    fixedQuality:            string[];
    vbrUpperCap:             Array<string | { _: string; $: { min: string; max: string } }>;
    vbrLowerCap:             string[];
    maxFrameRate:            string[];
    keyFrameInterval:        string[];
    snapShotImageType:       string[];
    GovLength:               string[];
    SVC:                     SVC[];
    PacketType:              string[];
    smoothing:               string[];
    H264Profile?:            string[];
    H265Profile?:            string[];
    SmartCodec?:             SmartCodec[];
}

export interface SVC {
    enabled: string[];
}

export interface SmartCodec {
    enabled: string[];
}

export interface DynamicCapRoot {
    DynamicCap: DynamicCap;
}

export interface DynamicCap {
    $:                                VersionXmlns;
    ResolutionAvailableDscriptorList: ResolutionAvailableDscriptorList[];
    CodecParamDscriptorList:          CodecParamDscriptorList[];
    AudioDscriptorList:               AudioDscriptorList[];
}

export interface AudioDscriptorList {
    audioCompressionType: AudioCompressionType[];
}

export interface AudioCompressionType {
    _: string;
    $: AudioCompressionTypeAttributes;
}

export interface AudioCompressionTypeAttributes {
    SupportedAudioBitRate:      string;
    SupportedAudioSamplingRate: string;
}

export interface CodecParamDscriptorList {
    CodecParamDscriptor: CodecParamDscriptor[];
}

export interface CodecParamDscriptor {
    videoCodecType:             string[];
    isSupportProfile:           string[];
    isSupportSVC:               string[];
    CBRCap:                     CBRCap[];
    VBRCap:                     VBRCap[];
    SmartCodecCap:              SmartCodecCap[];
}

export interface CBRCap {
    isSupportSmooth: string[];
}

export interface SmartCodecCap {
    readOnlyParams:           ReadOnlyParams[];
    BitrateType:              BitrateType[];
    smart264EnabledPrompt?:   ReadOnlyParams[];
    smart265EnabledPrompt?:   ReadOnlyParams[];
}

export interface BitrateType {
    Constant: ConstantVariable[];
    Variable: ConstantVariable[];
}

export interface ConstantVariable {
    support: ReadOnlyParams[];
}

export interface ReadOnlyParams {
    $: ReadOnlyParamsOpt;
}

export interface ReadOnlyParamsOpt {
    opt: string;
}

export interface VBRCap {
    isSupportSmooth: string[];
}

export interface ResolutionAvailableDscriptorList {
    ResolutionAvailableDscriptor: ResolutionAvailableDscriptor[];
}

export interface ResolutionAvailableDscriptor {
    videoResolutionWidth:  string[];
    videoResolutionHeight: string[];
    supportedFrameRate:    string[];
}

export interface VideoOverlay {
    $: VersionXmlns;
    normalizedScreenSize: NormalizedScreenSize[];
    TextOverlayList: TextOverlayList[];
    DateTimeOverlay: DateTimeOverlay[];
    channelNameOverlay: ChannelNameOverlay[];
}

export interface NormalizedScreenSize {
    normalizedScreenWidth: string[];
    normalizedScreenHeight: string[];
}

export interface TextOverlayList {
    $: { size: string };
    TextOverlay: TextOverlay[];
}

export interface TextOverlay {
    id: string[];
    enabled: string[];
    positionX: string[];
    positionY: string[];
    displayText: string[];
}

export interface DateTimeOverlay {
    enabled: string[];
    positionX: string[];
    positionY: string[];
    dateStyle: string[];
    timeStyle: string[];
    displayWeek: string[];
}

export interface ChannelNameOverlay {
    enabled: string[];
    positionX: string[];
    positionY: string[];
}

export interface PTZChanelCap {
    maxPresetNum: string[];
    PresetNameCap: PresetNameCap[];
}

export interface PresetNameCap {
    specialNo: SpecialNo[];
}

export interface SpecialNo {
    $: { opt: string };
}

export interface PTZPresetList {
    PTZPreset: PTZPreset[];
}

export interface PTZPreset {
    id: string[];
    presetName?: string[];
    enabled?: string[];
}
