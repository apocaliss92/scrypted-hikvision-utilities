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
